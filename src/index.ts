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
    .description('Mattermost CLI for humans and agents. Output is JSON by default.')
    .option('--human', 'Human-readable markdown output (default is JSON).', false)
    .option('--team <name>', 'Filter to a specific team.')
    .option('--debug', 'Enable debug output.', false)
    .addHelpText(
        'after',
        `
Note for AI/LLM agents:
  JSON is the default. Use --human for markdown output.
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
