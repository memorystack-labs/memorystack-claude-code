---
name: memory-save
description: Save a verified durable fact explicitly requested by the user.
---
Resolve the current cwd with memory_resolve_scope, then use memory_write for one verified fact with evidence and source bindings. Default to project; broader layers require configured scope and intended audience. Use memory_propose for unverified knowledge and memory_checkpoint for temporary progress. Never save raw transcripts or secrets. Consult coding-memory-capture for source freshness semantics.
