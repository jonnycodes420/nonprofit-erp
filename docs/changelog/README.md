# What's new

One file per build, named `YYYY-MM-DD-build-name.md`. The public What's new
page and the in-app panel read these files and nothing else; they are never
generated from commit messages. A super-admin can hide an entry from both.

Format:

```
date: 2026-10-01
title: A short title a customer understands
product: crm
---
Two or three plain sentences for a customer: what they can do now that they
could not before. No em dashes, no internal names.
```

`product` is one of: crm, giving, volunteers, agent, security, platform.
