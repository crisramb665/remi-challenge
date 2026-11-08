-- Projection of the contract events (SPEC section 3.4). Safe to run more than once.
-- Addresses are stored lowercase, and the CHECK constraints enforce it.

CREATE TABLE IF NOT EXISTS escrows (
  id              numeric PRIMARY KEY,
  sender          text NOT NULL CHECK (sender = lower(sender)),
  beneficiary     text NOT NULL CHECK (beneficiary = lower(beneficiary)),
  token           text NOT NULL CHECK (token = lower(token)),
  amount          numeric(78,0) NOT NULL,
  cancel_deadline bigint NOT NULL,
  expires_at      bigint NOT NULL,
  status          text NOT NULL,
  created_tx      text NOT NULL,
  created_block   bigint NOT NULL,
  resolved_tx     text,
  resolved_block  bigint,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escrows_sender_idx ON escrows (sender);
CREATE INDEX IF NOT EXISTS escrows_beneficiary_idx ON escrows (beneficiary);
CREATE INDEX IF NOT EXISTS escrows_status_idx ON escrows (status);

CREATE TABLE IF NOT EXISTS indexer_state (
  id         int PRIMARY KEY CHECK (id = 1),
  last_block bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
