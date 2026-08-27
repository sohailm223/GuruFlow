'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const DURATION = 2000; // 30 seconds

export default function TopLoader() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);

    const t = setTimeout(() => {
      setVisible(false);
    }, DURATION);

    return () => clearTimeout(t);
  }, []);

  return (
    <motion.div
      // NEVER unmount this component
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '6px',
        zIndex: 2147483647,
        pointerEvents: 'none',
      }}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* animated strip */}
      <motion.div
        style={{
          height: '100%',
          width: '300%',
          background:
            'linear-gradient(90deg, #4285F4, #EA4335, #FBBC05, #34A853, #4285F4)',
        }}
        animate={{ x: ['0%', '-66%'] }}
        transition={{
          duration: 1.2,
          ease: 'linear',
          repeat: Infinity,
        }}
      />
    </motion.div>
  );
}
