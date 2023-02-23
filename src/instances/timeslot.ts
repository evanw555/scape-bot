
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

let dayCounter = 0;
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
    incrementDay: () => {
        dayCounter++;
    },
    reset: () => {
        dayCounter = 0;
        for (let i = 0; i < NUM_SLOTS; i++) {
            playerUpdatesBySlot[i] = {};
        }
    },
    getNumUniqueRSNs: (): number => {
        return Object.keys(timeSlotInstance.getSlotsByPlayer()).length;
    },
    getSlotsByPlayer: (): Record<string, number[]> => {
        const result: Record<string, number[]> = {};
        for (let i = 0; i < NUM_SLOTS; i++) {
            for (const rsn of Object.keys(playerUpdatesBySlot[i])) {
                if (!result[rsn]) {
                    result[rsn] = [];
                }
                result[rsn].push(i);
            }
        }
        return result;
    },
    getNumUpdatesForSlot: (slot: number): number => {
        let total = 0;
        for (const num of Object.values(playerUpdatesBySlot[slot] ?? {})) {
            total += num;
        }
        return total;
    },
    getOverallDebugString: () => {
        let result = `Num updates by time slot over the past **${dayCounter}** day(s) for **${timeSlotInstance.getNumUniqueRSNs()}** players:`;
        for (let i = 0; i < NUM_SLOTS; i++) {
            result += `\n_${timeSlotStrings[i]}:_ **${timeSlotInstance.getNumUpdatesForSlot(i)}** updates`;
        }
        return result;
    },
    getConsistencyAnalysisString: () => {
        const slotsByPlayer = timeSlotInstance.getSlotsByPlayer();
        let result = 'How many different time slots did players get updates in?';
        // How many players played within one particular slot?
        for (let i = 1; i <= NUM_SLOTS; i++) {
            result += `\n_${i} slot${i === 1 ? '' : 's'}:_ **${Object.keys(slotsByPlayer).filter(rsn => slotsByPlayer[rsn].length === i).length}** player(s)`;
        }
        return result;
    }
};

timeSlotInstance.reset();

export default timeSlotInstance;
