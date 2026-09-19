-- PostgreSQL Schema Verification Script
-- Run this script to verify table structures and initial data integrity.

SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

SELECT * FROM roles;
