'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Mark } from './mark';

/** The company logo (decorative next to its name), or the product mark when none is set or the logo fails to load. */
export function BrandMark({ logoUrl, className = 'h-7 w-7' }: { logoUrl: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!logoUrl || failed) return <Mark className={className} />;
  return (
    <Image
      src={logoUrl}
      alt=""
      width={36}
      height={36}
      unoptimized
      className={`${className} shrink-0 object-contain`}
      onError={() => setFailed(true)}
    />
  );
}
