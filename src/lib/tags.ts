// T1.12 — Clash of Clans tag handling. The ONLY place tags are encoded (section 4).
// 
// normaliseTag()  '#2pp0jccl' -> '#2PP0JCCL'   uppercase, keep the hash, store this
// encodeTag()     '#2PP0JCCL' -> '%232PP0JCCL' for URLs only, never for storage
// 
// A tag that is not %23-encoded returns 404 from the API on an otherwise valid tag.
// The [clanTag] and [tag] route segments arrive encoded and must be decoded here.

export {};
