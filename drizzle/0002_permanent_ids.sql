CREATE TRIGGER profiles_assigned_id_insert BEFORE INSERT ON profiles WHEN NEW.handle NOT GLOB '[A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9]' BEGIN SELECT RAISE(ABORT, 'User ID must contain two uppercase letters and six digits'); END;
--> statement-breakpoint
CREATE TRIGGER profiles_permanent_id BEFORE UPDATE OF handle ON profiles WHEN OLD.handle GLOB '[A-Z][A-Z][0-9][0-9][0-9][0-9][0-9][0-9]' AND NEW.handle <> OLD.handle BEGIN SELECT RAISE(ABORT, 'User IDs cannot be changed'); END;
