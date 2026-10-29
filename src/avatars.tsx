import {
  Anchor, Bird, Cloud, Compass, Flame, Leaf, Moon, Mountain, Rocket, Star, Sun, Telescope,
  type LucideIcon,
} from 'lucide-react';

// Avatares temporários (a arte final será definida depois). As chaves vêm do servidor.
const AVATARS: Record<string, { Icon: LucideIcon; bg: string }> = {
  'avatar-01': { Icon: Compass, bg: '#DBB13B' },
  'avatar-02': { Icon: Rocket, bg: '#9FD3C7' },
  'avatar-03': { Icon: Star, bg: '#F2C6A0' },
  'avatar-04': { Icon: Leaf, bg: '#B7DDA0' },
  'avatar-05': { Icon: Sun, bg: '#F3E08A' },
  'avatar-06': { Icon: Moon, bg: '#C5C9F0' },
  'avatar-07': { Icon: Cloud, bg: '#BFE0F2' },
  'avatar-08': { Icon: Flame, bg: '#F4B4A6' },
  'avatar-09': { Icon: Anchor, bg: '#A9C7E8' },
  'avatar-10': { Icon: Mountain, bg: '#D4C4A8' },
  'avatar-11': { Icon: Bird, bg: '#E8BDE0' },
  'avatar-12': { Icon: Telescope, bg: '#C9E3B2' },
};

export function Avatar({ avatarKey, size = 40 }: { avatarKey: string; size?: number }) {
  const { Icon, bg } = AVATARS[avatarKey] ?? AVATARS['avatar-01']!;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, background: bg }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.55)} color="#0A0D29" strokeWidth={2} />
    </span>
  );
}
