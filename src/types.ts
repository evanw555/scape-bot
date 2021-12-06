export interface SerializedState {
    players: string[],
    trackingChannelId?: string,
    levels: Record<string, Record<string, number>>,
    bosses: Record<string, Record<string, number>>
}


export interface Command {
    fn: (msg: /*Message*/ any, rawArgs: string, ...args: string[]) => void
    text: string
    hidden?: boolean,
    privileged?: boolean
}