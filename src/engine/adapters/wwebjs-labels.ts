import { type Client } from 'whatsapp-web.js';
import { Label, ChatSummary } from '../interfaces/whatsapp-engine.interface';
import { GroupChat, BusinessClient, readWid } from '../types/whatsapp-web-js.types';
import { isChannelJid, chatKind } from '../identity/wa-id';
import { ChatLabelsUnsupportedError } from '../../common/errors/chat-labels-unsupported.error';
import { LabelNotFoundError } from '../../common/errors/label-not-found.error';
import { EngineTransportError } from '../../common/errors/engine-transport.error';
import { type WwebjsEngineHost } from './wwebjs-host';

/**
 * Chat-label operations (WhatsApp Business only) extracted from WhatsAppWebJsAdapter. The adapter
 * keeps the public methods as thin forwarders and injects the shared host surface (./wwebjs-host)
 * via closures, so the delegate never touches lifecycle state directly.
 */
export class WwebjsLabels {
  /**
   * The settled tail of each chat's label writes, so the next write starts after it; gone once the chat is idle.
   * Keyed by the id WhatsApp Web resolves the chat to, not by the id a caller typed.
   */
  private readonly chatWrites = new Map<string, Promise<void>>();

  constructor(private readonly host: WwebjsEngineHost) {}

  /** Post-ensureReady client handle. */
  private client(): Client {
    return this.host.getClient();
  }

  async getLabels(): Promise<Label[]> {
    this.host.ensureReady();
    const labels = await (this.client() as unknown as BusinessClient).getLabels();
    if (!labels) {
      return [];
    }

    return labels.map(label => ({
      id: String(label.id),
      name: String(label.name),
      hexColor: String(label.hexColor),
    }));
  }

  /**
   * Every chat carrying a label. Mapped to the neutral ChatSummary here rather than returned raw,
   * for the same reason getChats does it: no whatsapp-web.js type may cross the engine boundary.
   * Entries without a serialized id are skipped rather than failing the whole request.
   */
  async getChatsByLabel(labelId: string): Promise<ChatSummary[]> {
    this.host.ensureReady();
    // The upstream page code dereferences the label without checking it exists, so an unknown id —
    // and every id on a personal (non-Business) account, whose label collection is empty — throws a
    // page-side TypeError that would surface as an opaque 500. A label that is not there is a 404,
    // the same answer getLabelById gives.
    let chats: Awaited<ReturnType<BusinessClient['getChatsByLabelId']>>;
    try {
      chats = await (this.client() as unknown as BusinessClient).getChatsByLabelId(labelId);
    } catch (error) {
      // Same split the group read makes: a dead page is a 503, not "no such label".
      if (this.host.isPageTransportError(error)) {
        this.host.reportIfPageTransportError(error, 'getChatsByLabel');
        throw new EngineTransportError(`Transport died while listing chats for label ${labelId}`);
      }
      this.host.logger.debug('getChatsByLabelId rejected; treating the label as not found', {
        labelId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new LabelNotFoundError(labelId);
    }
    const summaries: ChatSummary[] = [];
    for (const chat of chats ?? []) {
      // The library builds this list via getChatById per label item and yields UNDEFINED entries
      // for chats that no longer resolve (Client.js getChatsByLabelId → ChatFactory) — the whole
      // entry, not just the id, so the optional chain must start at the entry itself.
      const id = chat?.id?._serialized;
      if (!id) continue;
      summaries.push({
        id,
        name: chat.name || id,
        isGroup: Boolean(chat.isGroup),
        kind: chatKind(id),
        unreadCount: chat.unreadCount || 0,
        timestamp: chat.timestamp || 0,
      });
    }
    return summaries;
  }

  async getLabelById(labelId: string): Promise<Label | null> {
    this.host.ensureReady();
    const label = await (this.client() as unknown as BusinessClient).getLabelById(labelId);
    if (!label) {
      return null;
    }
    return {
      id: String(label.id),
      name: String(label.name),
      hexColor: String(label.hexColor),
    };
  }

  async getChatLabels(chatId: string): Promise<Label[]> {
    this.host.ensureReady();
    if (isChannelJid(chatId)) {
      // A channel resolves to a wwebjs `Channel`, which has no getLabels() and carries no chat labels.
      // Return empty instead of letting the unguarded call throw a TypeError (HTTP 500).
      return [];
    }
    const chat = await this.client().getChatById(chatId);
    const labels = await (chat as unknown as GroupChat).getLabels();
    if (!labels) {
      return [];
    }

    return labels.map(label => ({
      id: String(label.id),
      name: String(label.name),
      hexColor: String(label.hexColor),
    }));
  }

  async addLabelToChat(chatId: string, labelId: string): Promise<void> {
    this.host.ensureReady();
    await this.changeChatLabel(chatId, labelId, true);
  }

  async removeLabelFromChat(chatId: string, labelId: string): Promise<void> {
    this.host.ensureReady();
    await this.changeChatLabel(chatId, labelId, false);
  }

  /**
   * whatsapp-web.js has no add-/remove-one-label primitive: `client.addOrRemoveLabels(ids, chats)` REPLACES
   * a chat's label set with `ids` (adding the listed labels, removing any existing label not listed). So
   * toggle a single label by reading the current set, mutating it, and writing the whole set back.
   * Labels are a WhatsApp Business feature — the write throws `[LT01]` on a personal account; channels
   * carry no labels at all. Both are surfaced as a 422 rather than an opaque 500.
   *
   * The read and write are separate calls, so two single-label writes to the SAME chat that overlap would undo
   * each other (the later one removes the label the earlier one just added). They run one after the other per
   * chat, whichever id names it; a write that waited re-reads the labels.
   */
  private async changeChatLabel(chatId: string, labelId: string, add: boolean): Promise<void> {
    if (isChannelJid(chatId)) {
      throw new ChatLabelsUnsupportedError('Channels do not support chat labels.');
    }
    const queue = await this.resolveChatId(chatId);
    // `previous` never rejects (it is the settled tail below), so a failed write does not stop the next.
    const previous = this.chatWrites.get(queue) ?? Promise.resolve();
    const write = previous.then(() => this.writeChatLabel(chatId, queue, labelId, add));
    const tail = write.then(
      () => undefined,
      () => undefined,
    );
    this.chatWrites.set(queue, tail);
    void tail.then(() => {
      if (this.chatWrites.get(queue) === tail) this.chatWrites.delete(queue);
    });
    await write;
  }

  /**
   * The id WhatsApp Web keys the chat by. A migrated contact's chat is keyed by its lid and found for the phone id as
   * well, so the writes to one chat have to queue under this id, not the one the caller typed. The typed id stands
   * in when the page resolves no chat or the lookup fails; the write itself then reports the problem as before.
   */
  private async resolveChatId(chatId: string): Promise<string> {
    try {
      const chat = await this.client().getChatById(chatId);
      return readWid(chat?.id) ?? chatId;
    } catch {
      return chatId;
    }
  }

  /**
   * `target` is the id WhatsApp Web keys the chat by: the page matches the write's chats by that exact id, so a
   * phone id naming a lid-keyed chat would match nothing and the write would silently do nothing.
   */
  private async writeChatLabel(chatId: string, target: string, labelId: string, add: boolean): Promise<void> {
    this.host.ensureReady();
    const ids = new Set((await this.getChatLabels(chatId)).map(label => label.id));
    if (add) {
      ids.add(labelId);
    } else {
      ids.delete(labelId);
    }
    try {
      await this.client().addOrRemoveLabels([...ids], [target]);
    } catch (error) {
      // whatsapp-web.js throws `[LT01] Only Whatsapp business` from the page context on a personal account.
      if (String(error instanceof Error ? error.message : error).includes('LT01')) {
        throw new ChatLabelsUnsupportedError();
      }
      throw error;
    }
    // The page drops an id it does not know and resolves, so the write left the chat unchanged. Checked
    // after the write, not before, so a personal account (no labels at all) still gets the LT01 422.
    if (add && !(await this.getLabels()).some(label => label.id === labelId)) {
      throw new LabelNotFoundError(labelId);
    }
    this.host.logger.log(`${add ? 'Added' : 'Removed'} label ${labelId} ${add ? 'to' : 'from'} chat ${chatId}`);
  }
}
