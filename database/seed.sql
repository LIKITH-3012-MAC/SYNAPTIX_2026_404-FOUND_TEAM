-- ============================================================
-- RESOLVIT - Seed Data
-- Passwords are bcrypt hashes of "Password123!"
-- ============================================================

-- Seed Users (admin, authorities, citizens)
INSERT INTO users (id, username, email, password_hash, role, full_name, department) VALUES
  ('00000000-0000-0000-0000-000000000001', 'admin', 'admin@resolvit.gov', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMZJaaaSwm.Gs6EY5D4G.3XNzG', 'admin', 'System Administrator', 'IT'),
  ('00000000-0000-0000-0000-000000000002', 'auth_roads', 'roads@resolvit.gov', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMZJaaaSwm.Gs6EY5D4G.3XNzG', 'authority', 'Roads Department', 'Public Works'),
  ('00000000-0000-0000-0000-000000000003', 'auth_water', 'water@resolvit.gov', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMZJaaaSwm.Gs6EY5D4G.3XNzG', 'authority', 'Water Board', 'Municipality'),
  ('00000000-0000-0000-0000-000000000004', 'auth_elec', 'electricity@resolvit.gov', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMZJaaaSwm.Gs6EY5D4G.3XNzG', 'authority', 'Electricity Board', 'BESCOM'),
  ('00000000-0000-0000-0000-000000000005', 'citizen1', 'citizen1@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMZJaaaSwm.Gs6EY5D4G.3XNzG', 'citizen', 'Rahul Kumar', NULL),
  ('00000000-0000-0000-0000-000000000006', 'citizen2', 'citizen2@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMZJaaaSwm.Gs6EY5D4G.3XNzG', 'citizen', 'Priya Singh', NULL)
ON CONFLICT DO NOTHING;

-- Seed Issues
INSERT INTO issues (id, title, description, category, latitude, longitude, urgency, impact_scale, status, priority_score, safety_risk_probability, reporter_id, assigned_authority_id, created_at) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Large Pothole on MG Road', 'Dangerous pothole near bus stop, causing accidents daily. Multiple vehicles damaged.', 'Roads', 12.9716, 77.5946, 5, 200, 'in_progress', 87.5, 0.85, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', NOW() - INTERVAL '5 days'),
  ('10000000-0000-0000-0000-000000000002', 'Water Supply Disruption - Koramangala', 'No water supply for 3 days in entire sector 5. Residents struggling.', 'Water', 12.9279, 77.6271, 5, 500, 'escalated', 95.2, 0.7, '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003', NOW() - INTERVAL '8 days'),
  ('10000000-0000-0000-0000-000000000003', 'Street Light Outage - HSR Layout', 'Entire stretch of 27th Main dark for 2 weeks. Safety concern at night.', 'Electricity', 12.9116, 77.6389, 4, 300, 'assigned', 76.0, 0.6, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000004', NOW() - INTERVAL '3 days'),
  ('10000000-0000-0000-0000-000000000004', 'Garbage Overflow - Indiranagar', 'Garbage not collected for 5 days. Overflow causing health hazard.', 'Sanitation', 12.9784, 77.6408, 4, 150, 'reported', 68.4, 0.5, '00000000-0000-0000-0000-000000000006', NULL, NOW() - INTERVAL '1 day'),
  ('10000000-0000-0000-0000-000000000005', 'Broken Footpath - Jayanagar', 'Footpath tiles broken and protruding. Multiple pedestrian injuries reported.', 'Roads', 12.9299, 77.5827, 3, 80, 'verified', 54.2, 0.4, '00000000-0000-0000-0000-000000000005', NULL, NOW() - INTERVAL '2 days'),
  ('10000000-0000-0000-0000-000000000006', 'Open Manhole - Whitefield', 'Uncovered manhole on busy road. Extremely dangerous. Child fell in last week.', 'Safety', 12.9698, 77.7499, 5, 1000, 'escalated', 98.5, 0.95, '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', NOW() - INTERVAL '10 days'),
  ('10000000-0000-0000-0000-000000000007', 'Tree Fallen Blocking Road', 'Large tree fell blocking main road after storm. Traffic at standstill.', 'Roads', 12.9542, 77.6102, 5, 400, 'resolved', 15.0, 0.3, '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', NOW() - INTERVAL '15 days'),
  ('10000000-0000-0000-0000-000000000008', 'Sewage Overflow - BTM Layout', 'Sewage spilling on road due to blocked drain. Health emergency.', 'Sanitation', 12.9166, 77.6101, 5, 350, 'in_progress', 88.0, 0.8, '00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003', NOW() - INTERVAL '4 days')
ON CONFLICT DO NOTHING;

-- Update resolved issue
UPDATE issues SET resolved_at = NOW() - INTERVAL '2 days', resolution_note = 'Tree cleared by Public Works team. Road fully accessible.' WHERE id = '10000000-0000-0000-0000-000000000007';

-- Seed Authority Metrics
INSERT INTO authority_metrics (authority_id, total_assigned, total_resolved, total_escalated, avg_response_time, avg_resolution_time, resolution_rate, escalation_rate, performance_score) VALUES
  ('00000000-0000-0000-0000-000000000002', 12, 8, 2, 4.5, 48.0, 0.67, 0.17, 78.5),
  ('00000000-0000-0000-0000-000000000003', 8, 4, 3, 8.2, 72.0, 0.50, 0.38, 58.2),
  ('00000000-0000-0000-0000-000000000004', 6, 5, 1, 2.3, 24.0, 0.83, 0.17, 91.4)
ON CONFLICT DO NOTHING;

-- Seed Escalation Events
INSERT INTO escalations (issue_id, reason, previous_status, escalated_at) VALUES
  ('10000000-0000-0000-0000-000000000002', 'Unresolved for 8 days exceeding 7-day SLA. Citizen complaints increasing.', 'in_progress', NOW() - INTERVAL '1 day'),
  ('10000000-0000-0000-0000-000000000006', 'Critical safety incident. Child fell into open manhole. Immediate action required.', 'assigned', NOW() - INTERVAL '3 days')
ON CONFLICT DO NOTHING;
