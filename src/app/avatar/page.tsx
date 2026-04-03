import { redirect } from "next/navigation";

export default async function AvatarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  const resolved = await searchParams;
  Object.entries(resolved).forEach(([key, value]) => {
    if (typeof value === "string") params.set(key, value);
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
  });
  const query = params.toString();
  redirect(query ? `/live/room?${query}` : "/live/room");
}
