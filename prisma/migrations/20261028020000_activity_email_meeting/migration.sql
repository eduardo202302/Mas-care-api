-- Point 4: Correo and Reunión activities in the history.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'email';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'meeting';
