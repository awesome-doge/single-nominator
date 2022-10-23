import {Address, Cell, Contract, contractAddress, ContractSource, InternalMessage, Message, TonClient} from "ton";
import {sign} from "ton-crypto";
import {SingleNominator} from "./single-nominator";

export type Maybe<T> = T | null | undefined;

class WalletV3SigningMessage implements Message {

    readonly timeout: number;
    readonly seqno: number;
    readonly walletId: number;
    readonly order: Message | null;
    readonly sendMode: number;

    constructor(args: { timeout?: Maybe<number>, seqno: Maybe<number>, walletId?: number, sendMode: number, order: Message | null }) {
        this.order = args.order;
        this.sendMode = args.sendMode;
        if (args.timeout !== undefined && args.timeout !== null) {
            this.timeout = args.timeout;
        } else {
            this.timeout = Math.floor(Date.now() / 1e3) + 60; // Default timeout: 60 seconds
        }
        if (args.seqno !== undefined && args.seqno !== null) {
            this.seqno = args.seqno;
        } else {
            this.seqno = 0;
        }
        if (args.walletId !== null && args.walletId !== undefined) {
            this.walletId = args.walletId;
        } else {
            this.walletId = 698983191;
        }
    }

    writeTo(cell: Cell) {
        cell.bits.writeUint(this.walletId, 32);
        if (this.seqno === 0) {
            for (let i = 0; i < 32; i++) {
                cell.bits.writeBit(1);
            }
        } else {
            cell.bits.writeUint(this.timeout, 32);
        }
        cell.bits.writeUint(this.seqno, 32);
        cell.bits.writeUint8(0); // Simple order

        // Write order
        if (this.order) {
            cell.bits.writeUint8(this.sendMode);
            let orderCell = new Cell();
            this.order.writeTo(orderCell);
            cell.refs.push(orderCell);
        }
    }
}

export class SingleNominatorContract implements Contract {

    static create(opts: {owner: Address; validator: Address}) {
		// Build initial code and data
		let initialCode = SingleNominator.getCode(false)[0];
		let initialData = new Cell();
		initialData.bits.writeAddress(opts.owner);
		initialData.bits.writeAddress(opts.validator);

        return new SingleNominatorContract(initialCode, initialData, -1);
    }

    readonly address: Address;
    readonly source: ContractSource;

    constructor(initialCode: Cell, initialData: Cell, workchain = -1) {
        this.source = {initialCode: initialCode, initialData: initialData, workchain: -1} as ContractSource;
		this.address = contractAddress({initialCode: initialCode, initialData: initialData, workchain: workchain});
    }

    async getSeqNo(client: TonClient) {
        if (await client.isContractDeployed(this.address)) {
            let res = await client.callGetMethod(this.address, 'seqno');
            return parseInt(res.stack[0][1], 16);
        } else {
            return 0;
        }
    }

    async createTransfer(args: {
        seqno: number,
        sendMode: number,
        walletId: number,
        order: InternalMessage | null,
        secretKey?: Maybe<Buffer>,
        timeout?: Maybe<number>
    }) {

        let signingMessage = new WalletV3SigningMessage({
            timeout: args.timeout,
            walletId: args.walletId,
            seqno: args.seqno,
            sendMode: args.sendMode,
            order: args.order
        });

        // Sign message
        const cell = new Cell();
        signingMessage.writeTo(cell);
        let signature: Buffer;
        if (args.secretKey) {
            signature = sign(cell.hash(), args.secretKey);
        } else {
            signature = Buffer.alloc(64);
        }

        // Body
        const body = new Cell();
        body.bits.writeBuffer(signature);
        signingMessage.writeTo(body);

        return body;
    }
}
