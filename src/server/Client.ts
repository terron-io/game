import WebSocket from "ws";
import { TokenPayload } from "../core/ApiSchemas";
import { Tick } from "../core/game/Game";
import { ClientID, InputMode, PlayerCosmetics, Winner } from "../core/Schemas";
import { DeviceKind } from "./Device";

export class Client {
  public lastPing: number = Date.now();

  public hashes: Map<Tick, number> = new Map();

  public reportedWinner: Winner | null = null;

  constructor(
    public readonly clientID: ClientID,
    public readonly persistentID: string,
    public readonly claims: TokenPayload | null,
    public readonly role: string | null,
    public readonly flares: string[] | undefined,
    public readonly ip: string,
    public username: string,
    public clanTag: string | null,
    public ws: WebSocket,
    public readonly cosmetics: PlayerCosmetics | undefined,
    public readonly publicId: string | undefined,
    public readonly friends: string[],
    // terron: устройство по UA апгрейда (спидран-значок, см. Device.ts).
    // undefined = не распознали. Ставится на join, реконнект его не меняет.
    public readonly device: DeviceKind | undefined = undefined,
  ) {}

  // terron: чем игрок РЕАЛЬНО играет (палец/мышь/смешанно) — приходит от
  // клиента сообщением input_mode при смене классификации. Сильнее UA:
  // именно по нему рисуется значок «забег с телефона». Мутабельно —
  // «мышь» может стать «смешанным» посреди матча.
  public inputMode: InputMode | undefined = undefined;
  // terron: «смерть уже отправлена в API» — гард от повторов (клиент шлёт один
  // раз, но реконнект/битый бандл могут повторить, а это деньги).
  public deathReported = false;
}
