#!/usr/bin/env node
import { Command } from 'commander'
import { registerAuthCommand } from './commands/auth.js'
import { registerChannelsCommand } from './commands/channels.js'
import { registerMessagesCommand } from './commands/messages.js'
import { registerOverviewCommand } from './commands/overview.js'
import { registerPeopleCommand } from './commands/people.js'
import { registerSearchCommand } from './commands/search.js'

const program = new Command()

program
    .name('mm')
    .version('0.1.0')
    .description('Mattermost CLI for humans and agents.')
    .option('--team <name>', 'Filter to a specific team.')
    .option('--debug', 'Enable debug output.', false)
    .addHelpText(
        'after',
        `
All commands support:
  (default)   Colored human-readable output
  --json      Pretty JSON with essential fields
  --json --full  All fields
  --ndjson    One JSON object per line (for piping)
  --raw       Raw markdown without ANSI colors

Note for AI/LLM agents:
  Each post has thread_id (pass to 'mm thread') and channels expose 'ref' (pass to 'mm messages').`,
    )

registerAuthCommand(program)
registerOverviewCommand(program)
registerChannelsCommand(program)
registerMessagesCommand(program)
registerSearchCommand(program)
registerPeopleCommand(program)

program.parseAsync().catch((err: Error) => {
    console.error(err.message)
    process.exit(1)
})
