import Image from "next/image";

export function Logo({ size = 40 }: { size?: number }) {
  return <Image src="/logo.png" alt="Tiệm Bơ Sầu" width={size} height={size} priority className="rounded-full bg-white" />;
}
