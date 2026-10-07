---
type: note
title: A doc with hostile text
status: draft
updated: 2026-01-05
---
# A doc with hostile text

This sample doc holds the kind of text that a web page must never run. Every tag below is only text: the site shows it as it is and runs none of it.

<script>window.__ccHostile = 'a script ran'</script>

<img src="x" onerror="window.__ccHostile = 'an onerror ran'">

<a href="https://example.invalid" onclick="window.__ccHostile = 'a click ran'">A raw anchor</a>

<iframe src="https://example.invalid/frame"></iframe>

## A heading with a tag in it: <b>bold</b>

The words above this paragraph are a heading. Its id comes from its words, and no markup reaches the id.
