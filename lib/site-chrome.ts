// "/" is the only route that mounts the game and locks page scroll; every
// other route is a normal scrolling document with a "Play Lullwood" header.
export function isGameRoute(pathname: string | null): boolean {
  return pathname === '/' || pathname === null || pathname === '';
}

export function showPlayHeader(pathname: string | null): boolean {
  if (isGameRoute(pathname)) return false;
  return !(pathname as string).startsWith('/internal');
}
