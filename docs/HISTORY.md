# History

Every export archives its batch here. The point of the tab is that an export
is not a one-way door: whatever you could have done with the report at the
moment you sent it, you can still do a day later.

That was not true. History could copy the prompt, save `.md` and `.json`,
restore and delete — while the live export menu had grown JSON-to-clipboard,
four file formats, Submit and Send to agent. And the archived batch quietly
lost the one field that says _why_ it exists.

## What a record holds

`ExportRecord` = the annotations, the URL and title they came from, the method
it left by, **and the task**. The task is the user's stated intent; the export
prompt leads with it as a `## Task` section. Archiving used to clear the task
without keeping it, so re-exporting from History produced a report that had
lost its point. It travels with the batch now, and comes back with it.

Restore puts the task back only when the task field is empty. If you have
already typed a new one, that is the live intent and History does not overwrite
it.

## Actions on a record

The expanded row offers exactly what the export menu offers, against the
archived batch instead of the live one:

| Action                       | Notes                                                |
| ---------------------------- | ---------------------------------------------------- |
| Copy / Copy JSON             | The prompt, or the whole payload                     |
| `.md` `.json` `.html` `.pdf` | The same four formats as the menu                    |
| Submit                       | Only with a server configured                        |
| Send to agent                | Only with an agent to take it; disabled with reason  |
| Restore                      | Pulls the batch (and its task) back into the session |
| Delete                       | Drops the record                                     |

Submitting from History does **not** re-archive: the batch is already a record,
and a second copy of it in the list would be noise. It also does not clear the
live batch — a resend of something old must not throw away what you are
working on now.

**The buttons are labelled.** Seven bare glyphs in a row, two of them the same
download arrow for `.md` and `.json`, is not a control surface anyone can read.
Formats carry their extension; the rest carry a word.
