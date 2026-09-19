-- PostgreSQL Schema for Parking Management System (Phase 1)
-- Execute in an empty application database.

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE CHECK(name IN ('admin','operator'))
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role_id BIGINT NOT NULL REFERENCES roles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zones (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  simulator_name VARCHAR(255) NOT NULL UNIQUE,
  co_level NUMERIC CHECK(co_level >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parking_spots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  simulator_name VARCHAR(255) NOT NULL UNIQUE,
  zone_id BIGINT NOT NULL REFERENCES zones(id),
  spot_type VARCHAR(255) NOT NULL CHECK(spot_type IN ('any','electric','accessible')),
  occupancy_status VARCHAR(255) NOT NULL DEFAULT 'free' CHECK(occupancy_status IN ('free','reserved','occupied')),
  health_status VARCHAR(255) NOT NULL DEFAULT 'normal' CHECK(health_status IN ('normal','broken','maintenance')),
  usage_count BIGINT NOT NULL DEFAULT 0 CHECK(usage_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  simulator_name VARCHAR(255) NOT NULL UNIQUE,
  device_type VARCHAR(255) NOT NULL CHECK(device_type IN ('gate','light','fan','entry_sensor','exit_sensor')),
  zone_id BIGINT REFERENCES zones(id),
  group_name VARCHAR(255),
  operating_state VARCHAR(255),
  health_status VARCHAR(255) NOT NULL DEFAULT 'normal' CHECK(health_status IN ('normal','broken','maintenance')),
  usage_count BIGINT CHECK(usage_count >= 0),
  runtime_seconds BIGINT CHECK(runtime_seconds >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parking_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plate_number VARCHAR(255) NOT NULL,
  car_type VARCHAR(255) NOT NULL,
  parking_spot_id BIGINT REFERENCES parking_spots(id),
  status VARCHAR(255) NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','heading_to_spot','parked','awaiting_payment','ready_to_exit','departed','cancelled')),
  arrived_at TIMESTAMPTZ NOT NULL,
  parked_at TIMESTAMPTZ,
  unparked_at TIMESTAMPTZ,
  departed_at TIMESTAMPTZ,
  parking_duration_seconds BIGINT CHECK(parking_duration_seconds >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_active_plate ON parking_sessions(plate_number) WHERE status NOT IN ('departed','cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS ux_active_spot ON parking_sessions(parking_spot_id) WHERE status IN ('heading_to_spot','parked');
CREATE INDEX IF NOT EXISTS sessions_arrival ON parking_sessions(arrived_at);
CREATE INDEX IF NOT EXISTS sessions_status ON parking_sessions(status);
CREATE INDEX IF NOT EXISTS sessions_plate ON parking_sessions(plate_number);

CREATE TABLE IF NOT EXISTS invoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parking_session_id BIGINT NOT NULL UNIQUE REFERENCES parking_sessions(id),
  billable_minutes BIGINT NOT NULL CHECK(billable_minutes >= 0),
  rate_per_minute_minor BIGINT NOT NULL CHECK(rate_per_minute_minor >= 0),
  amount_due_minor BIGINT NOT NULL CHECK(amount_due_minor >= 0),
  status VARCHAR(255) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','requested','paid','cancelled')),
  requested_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id),
  external_payment_id VARCHAR(255) UNIQUE,
  reported_amount_minor BIGINT CHECK(reported_amount_minor >= 0),
  verification_status VARCHAR(255) NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending','valid','invalid')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS payments_invoice ON payment_attempts(invoice_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_event_id VARCHAR(255) UNIQUE,
  event_type VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processing_status VARCHAR(255) NOT NULL DEFAULT 'pending' CHECK(processing_status IN ('pending','processed','failed')),
  processed_at TIMESTAMPTZ,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS events_processing ON webhook_events(processing_status, received_at);

INSERT INTO roles(name) VALUES ('admin'), ('operator') ON CONFLICT (name) DO NOTHING;
