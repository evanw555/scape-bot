#!/bin/bash

# Run bot and restart on process kill, try after 5s if cannot stay up for 1s
forever --minUptime 1000 --spinSleepTime 5000 start bot.js
