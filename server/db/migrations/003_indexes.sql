CREATE INDEX idx_snippets_user_id   ON snippets(user_id);
CREATE INDEX idx_snippets_created   ON snippets(created_at DESC, id DESC); -- supports pagination
CREATE INDEX idx_snippets_public    ON snippets(is_public) WHERE is_public = true; -- partial index
