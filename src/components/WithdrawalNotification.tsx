import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';

const names = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Quinn", "Sam", "Charlie"];

export const WithdrawalNotification = () => {
  const [notification, setNotification] = useState<{name: string, amount: number, avatar: string} | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const name = names[Math.floor(Math.random() * names.length)];
      const amount = Math.floor(Math.random() * 4900) + 100;
      const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`;
      setNotification({ name, amount, avatar });
      setTimeout(() => setNotification(null), 5000);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AnimatePresence>
      {notification && (
        <motion.div
          initial={{ opacity: 0, x: -50 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -50 }}
          className="fixed bottom-6 left-6 z-50 glass-card p-4 flex items-center gap-4 shadow-2xl border border-slate-800"
        >
          <img src={notification.avatar} alt={notification.name} className="w-10 h-10 rounded-full bg-slate-800" referrerPolicy="no-referrer" />
          <div>
            <p className="text-xs text-slate-400">Recent Withdrawal</p>
            <p className="text-sm font-bold">{notification.name} withdrew ${notification.amount.toLocaleString()}</p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-emerald-500" />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
