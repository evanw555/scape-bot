export interface SerializedState {
    players: string[],
    trackingChannelId?: string,
    levels: Record<string, Record<string, number>>,
    bosses: Record<string, Record<string, number>>
}
