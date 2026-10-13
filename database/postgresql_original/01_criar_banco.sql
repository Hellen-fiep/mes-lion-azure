\set ON_ERROR_STOP on
SELECT 'CREATE ROLE meslion LOGIN PASSWORD ''meslion''' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname='meslion')\gexec
SELECT 'CREATE DATABASE meslion OWNER meslion ENCODING ''UTF8''' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='meslion')\gexec
GRANT ALL PRIVILEGES ON DATABASE meslion TO meslion;
