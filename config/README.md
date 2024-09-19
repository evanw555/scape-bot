# Config Instructions

Create a file in this directory called `auth.json`, which looks something like this:

```
{
    "token": "<YOUR_TOKEN>",
    "adminUserId": "<ADMIN_USER_ID>",
    "pg": { <PG_CONFIG> },
    "clientId": "<CLIENT_ID>",
    "maintainerUserIds": ["<MAINTAINER_USER_ID>"],
    "channelLoggers": [{
        "id": "<CHANNEL_LOGGER_ID>",
        "level": "<LOGGER_LEVEL>",
        "dm": <IS_CHANNEL_DM>
    }]
}
```

where `<YOUR_TOKEN>` is the bot's token,

`<ADMIN_USER_ID>` is the ID of whichever Discord user owns the bot,

`<PG_CONFIG>` is the connection object for the postgres instance,

`<CLIENT_ID>` is the bot client's ID (optional, only needed to deploy commands),

`<MAINTAINER_USER_ID>` is a Discord user ID which should be given maintainer access (optional),

`CHANNEL_LOGGER_ID>` is a channel where the bot can send admin logs at a particular `<LOGGER_LEVEL>` (optional)
