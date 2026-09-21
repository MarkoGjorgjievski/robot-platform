import { cn } from '../../lib/utils';

/**
 * The only chroma in the chrome: a square tile in the user's own colour
 * (`users.avatar_colour`, one of eight, derived from their email) carrying an
 * initial. Square rather than round — this is a console, and the eight
 * avatar colours are all light and saturated, so the glyph is near-black on
 * every one of them and in both themes.
 */
export function AvatarSquare({
  initial,
  colour,
  size = 22,
  className,
}: {
  initial: string;
  colour: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 select-none items-center justify-center rounded-[4px] font-semibold', className)}
      style={{
        width: size,
        height: size,
        background: colour,
        color: '#0a0a0a',
        fontSize: Math.round(size * 0.52),
        lineHeight: 1,
      }}
    >
      {initial.slice(0, 1).toUpperCase()}
    </span>
  );
}
