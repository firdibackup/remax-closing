-- Hermes mengambil antrean tapi tidak mengirim WA (mis. semua closing kantor itu sudah dilaporkan).
-- Dilaporkan lewat POST /api/bot/reminder-skip: done_at diisi, message_id kosong, skip_reason diisi.
alter table closing.bot_reminder_requests add column if not exists skip_reason text;
