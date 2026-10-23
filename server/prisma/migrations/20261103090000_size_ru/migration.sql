-- Russian clothing sizes (42–64) as a grid of their own, next to the international letters.
ALTER TYPE "SizeSystem" ADD VALUE IF NOT EXISTS 'RU' AFTER 'ALPHA';
