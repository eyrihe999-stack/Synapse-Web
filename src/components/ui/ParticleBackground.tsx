import { useMemo } from 'react';

export function ParticleBackground() {
  const particles = useMemo(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      left: `${Math.random() * 100}%`,
      size: 2 + Math.random() * 3,
      duration: 15 + Math.random() * 20,
      delay: Math.random() * 15,
    })),
    [],
  );

  return (
    <div className="particles-container">
      {particles.map((p) => (
        <div
          key={p.id}
          className="particle"
          style={{
            left: p.left,
            width: p.size,
            height: p.size,
            background: '#2c7be5',
            opacity: 0.1,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
