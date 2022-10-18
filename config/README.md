# Config Instructions

Create a file in this directory called `auth.json`, which looks something like this:

```
{
    "token": "<YOUR_TOKEN>",
    "adminUserId": "<ADMIN_USER_ID>",
    "pg": { <PG_CONFIG> },
    "clientId": "<CLIENT_ID>",
    "guildId": "<GUILD_ID>"
}
```

where `<YOUR_TOKEN>` is the bot's token,

`<ADMIN_USER_ID>` is the ID of whichever Discord user owns the bot,

`<PG_CONFIG>` is the connection object for the postgres instance,

`<PG_PASSWORD>` is the password of the postgres user,

`<CLIENT_ID>` is the bot client's ID (optional, only needed to deploy commands),

`<GUILD_ID>` is ID of the guild you want to set commands for (optional, only needed to deploy guild-specific commands).
