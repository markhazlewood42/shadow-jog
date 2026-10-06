---
type: guide
title: Setup guide
status: approved
updated: 2026-01-10
---
# Setup guide

This guide walks through installing the Burrow toolkit on a fresh machine. Burrow is a made-up product: this file is a sample doc for the tests of the command center, and nothing in it describes a real tool. The [glossary](../reference/glossary.md#quokka) explains the terms, and the [diagram doc](../diagram.md) shows the flow of one run.

## Requirements

Burrow needs a recent operating system, a few gigabytes of free disk space and a network connection for the first run. The list says what each part is for.

- A 64-bit processor, so the indexer can map large files.
- Four gigabytes of memory, or more for big projects.
- A folder that your account can write to.

The requirements are the same on every machine. A build server needs no more than a laptop does, and a laptop needs no less than a build server.

### Hardware

A laptop from the last five years is enough. A desktop with a fast disk makes the first index run noticeably quicker, because the indexer reads every file once and then keeps its notes in memory.

The indexer is happy with slow disks, but it is not happy with full ones. Keep ten percent of the disk free, and the index will never stall halfway through a run.

### Software

Install the runtime first. Check its version with the version command and compare it with the table in the [tables doc](../tables.md). A version that is too old stops with a clear message, and a version that is too new only prints a warning.

## Installing

Download the archive, unpack it into a folder of your choice and run the install script. The script asks three questions: where to keep the data, which port to use and whether to start at login.

The script itself is short: read [the sample build script](../../scripts/build.sh) before you run it. The default answers are fine for a first try. Every answer is stored in one settings file, so a wrong choice is a one-line edit later and never a reinstall.

Run the script from a terminal, not from a file manager. A file manager hides the questions, and the script waits for answers that nobody can see.

## First run

The first run builds the index. For a project of a few hundred files it takes about a minute, and for a project of a few thousand files it takes a coffee break.

While the index builds, the status line shows how many files are done. You can stop the run at any time with the interrupt key. The next run picks up where the last one stopped.

## Storage

Burrow keeps its data in one folder, and the folder has three parts. The index holds the notes about your files. The cache holds the results of slow steps. The journal holds a short line for every run.

The cache is the only part that can grow without limit. A wombat sanctuary keeps a similar ledger: every visitor is written down once, and the old pages are archived when the book is full. Burrow does the same with its cache pages, and the archive step runs once a week.

Back up the index and the journal, and let the cache rebuild itself. A lost cache costs time. A lost index costs a first run.

## Upgrading

Upgrade by unpacking the new archive over the old folder and running the install script again. The script sees the settings file and asks no questions.

Read the change notes first. A change that needs a manual step is marked at the top of the notes, in the first paragraph, so it cannot be missed.

## Troubleshooting

Most problems have one of three causes: a full disk, a busy port or an old runtime. The status command names the cause when it knows it.

If the status command says nothing useful, run Burrow with the verbose flag and read the last twenty lines of the output. The last twenty lines answer more questions than the first two hundred.

A port that is busy is the most common cause. Pick another port in the settings file and start again.

## Uninstalling

Stop Burrow, delete its folder and delete the data folder. Nothing else is left on the machine: Burrow writes no registry keys, no hidden files and no start-up entries unless you asked for a start at login.

If you asked for a start at login, turn it off first with the settings command, then delete the folders.

## Appendix

The sample table in the [tables doc](../tables.md) lists the versions that were tested. The [repeated headings doc](../duplicate-headings.md) is a sample of a doc whose headings share names.

## Root

The root of the data folder holds the three parts of the storage, and nothing else. This heading is named like the root element of the page on purpose: a test checks that a link to it scrolls to this heading, not to the top of the page.
