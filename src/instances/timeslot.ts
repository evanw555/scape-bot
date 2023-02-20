
const NUM_SLOTS = 8;

const timeSlotStrings: Record<number, string> = {
    0: 'midnight-3am',
    1: '3-6am',
    2: '6-9am',
    3: '9-noon',
    4: 'noon-3pm',
    5: '3-6pm',
    6: '6-9pm',
    7: '9-midnight'
};

const playerUpdatesBySlot: Record<number, Record<string, number>> = {};

const getTimeSlot = (): number => {
    return Math.floor(NUM_SLOTS * new Date().getHours() / 24);
};

const timeSlotInstance = {
    incrementPlayer: (rsn: string) => {
        const timeSlot = getTimeSlot();
        if (!playerUpdatesBySlot[timeSlot][rsn]) {
            playerUpdatesBySlot[timeSlot][rsn] = 0;
        }
        playerUpdatesBySlot[timeSlot][rsn]++;
    },
    reset: () => {
        for (let i = 0; i < NUM_SLOTS; i++) {
            playerUpdatesBySlot[i] = {};
        }
    },
    getNumUpdatesForSlot: (slot: number): number => {
        let total = 0;
        for (const num of Object.values(playerUpdatesBySlot[slot] ?? {})) {
            total += num;
        }
        return total;
    },
    getOverallDebugString: () => {
        let result = 'Num updates by time slot:';
        for (let i = 0; i < NUM_SLOTS; i++) {
            result += `\n${timeSlotStrings[i]}: **${timeSlotInstance.getNumUpdatesForSlot(i)}** updates`;
        }
        return result;
    }
};

timeSlotInstance.reset();

export default timeSlotInstance;
