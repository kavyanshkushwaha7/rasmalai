-- Isolate the enum change so PostgreSQL can commit it before the next migration
-- uses the new value in a SECURITY DEFINER function.
ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE_REQUEST_ACCEPTED';
