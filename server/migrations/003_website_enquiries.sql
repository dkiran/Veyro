-- Enquiries sent from the public website (veyrotrack.com) contact form.
-- They belong to Veyro itself, not to any customer organisation, so there is no org_id.
CREATE TABLE IF NOT EXISTS website_enquiries (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  interest    text NOT NULL,
  name        text NOT NULL,
  company     text NOT NULL,
  email       text NOT NULL,
  phone       text NOT NULL,
  fleet_size  text,
  industry    text,
  message     text,
  ip          text,
  mail_status text NOT NULL DEFAULT 'pending',  -- pending | sent | failed | not_configured
  mail_error  text
);
CREATE INDEX IF NOT EXISTS website_enquiries_created_idx ON website_enquiries (created_at DESC);
