import React, { useEffect, useState } from 'react';

// In-memory cache for loaded SVG strings to avoid redundant network requests
const svgCache = new Map<string, string>();

interface SymbolIconProps extends React.SVGProps<SVGSVGElement> {
  name: string; // SF Symbol name e.g. "display", "server.rack", "lock.fill", "star.fill"
  className?: string;
  size?: number | string;
}

export const SymbolIcon: React.FC<SymbolIconProps> = ({
  name,
  className = 'w-5 h-5 text-current',
  size,
  ...props
}) => {
  const [svgContent, setSvgContent] = useState<string | null>(svgCache.get(name) || null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (svgCache.has(name)) {
      setSvgContent(svgCache.get(name)!);
      return;
    }

    let isMounted = true;
    const cleanName = name.endsWith('.svg') ? name : `${name}.svg`;

    fetch(`/symbols/${cleanName}`)
      .then((res) => {
        if (!res.ok) throw new Error('Symbol not found');
        return res.text();
      })
      .then((svgText) => {
        if (isMounted) {
          // Normalize SVG: ensure it inherits color and handles dimensions
          const cleaned = svgText
            .replace(/<\?xml.*?\?>/i, '')
            .replace(/<!DOCTYPE.*?>/i, '')
            .replace(/width="[^"]*"/i, '')
            .replace(/height="[^"]*"/i, '')
            .replace(/fill="none"/gi, 'data-none="true"')
            .replace(/fill="#?[0-9a-fA-F]+"/gi, 'fill="currentColor"')
            .replace(/stroke="#?[0-9a-fA-F]+"/gi, 'stroke="currentColor"');

          svgCache.set(name, cleaned);
          setSvgContent(cleaned);
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasError(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [name]);

  if (hasError || !svgContent) {
    // Elegant fallback icon (questionmark.circle)
    return (
      <span
        className={`inline-flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
        {...(props as any)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-full h-full"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:fill-current ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svgContent }}
      {...(props as any)}
    />
  );
};
