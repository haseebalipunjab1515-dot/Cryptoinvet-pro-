import { WithdrawalNotification } from "./components/WithdrawalNotification";
import { motion, AnimatePresence } from "motion/react";
import { 
  TrendingUp, 
  ShieldCheck, 
  Zap, 
  Wallet, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Copy, 
  Check,
  LayoutDashboard,
  PieChart,
  History,
  LogOut,
  X,
  Menu,
  DollarSign,
  ChevronRight,
  ChevronDown,
  Star,
  LogIn,
  User as UserIcon,
  AlertCircle,
  Loader2,
  Plus,
  Briefcase,
  Users,
  Headphones,
  MessageCircle
} from "lucide-react";
import { useState, useEffect, type ReactNode, type FormEvent, useCallback } from "react";
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  onAuthStateChanged, 
  type User, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  updateDoc,
  writeBatch,
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  serverTimestamp,
  handleFirestoreError,
  OperationType
} from "./firebase";

import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';

// --- Types ---
interface Plan {
  id: string;
  name: string;
  minDeposit: number;
  maxDeposit: number;
  dailyProfit: number;
  durationDays: number;
  color: string;
  description: string;
  historicalPerformance: { day: string; profit: number }[];
  riskFactors: string[];
}

interface UserProfile {
  uid: string;
  email: string;
  username?: string;
  balance: number;
  totalInvested: number;
  totalProfit: number;
  createdAt: any;
  role?: string;
  referredBy?: string;
  referralCount: number;
  activeReferralCount: number;
  totalReferralEarnings: number;
  claimedTiers?: number[];
}

const REFERRAL_TIERS = [
  { count: 5, reward: 50, name: "Bronze" },
  { count: 10, reward: 150, name: "Silver" },
  { count: 25, reward: 500, name: "Gold" },
  { count: 50, reward: 1500, name: "Platinum" },
  { count: 100, reward: 5000, name: "Diamond" }
];

interface Transaction {
  id: string;
  uid: string;
  amount: number;
  type: 'Deposit' | 'Withdrawal' | 'Profit' | 'Investment' | 'Referral Reward';
  status: 'pending' | 'completed' | 'rejected' | 'active';
  createdAt: any;
  address?: string;
  txId?: string;
  planId?: string;
  fromUser?: string;
}

const AdminPanel = ({ profile }: { profile: UserProfile }) => {
  const [pendingDeposits, setPendingDeposits] = useState<Transaction[]>([]);
  const [pendingWithdrawals, setPendingWithdrawals] = useState<Transaction[]>([]);
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [isProcessingProfits, setIsProcessingProfits] = useState(false);
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalInvested: 0,
    totalProfit: 0,
    totalBalance: 0
  });

  useEffect(() => {
    if (profile.role !== 'admin' && profile.email !== "haseeb.ali.punjab1515@gmail.com") return;

    const unsubStats = onSnapshot(collection(db, 'users'), (snap) => {
      let invested = 0;
      let profit = 0;
      let balance = 0;
      snap.docs.forEach(doc => {
        const data = doc.data() as UserProfile;
        invested += data.totalInvested || 0;
        profit += data.totalProfit || 0;
        balance += data.balance || 0;
      });
      setStats({
        totalUsers: snap.size,
        totalInvested: invested,
        totalProfit: profit,
        totalBalance: balance
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users (admin stats)'));

    const unsubDeps = onSnapshot(query(collection(db, 'deposits'), where('status', '==', 'pending')), (snap) => {
      setPendingDeposits(snap.docs.map(d => ({ ...d.data(), id: d.id, type: 'Deposit' } as Transaction)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'deposits (admin)'));

    const unsubWiths = onSnapshot(query(collection(db, 'withdrawals'), where('status', '==', 'pending')), (snap) => {
      setPendingWithdrawals(snap.docs.map(d => ({ ...d.data(), id: d.id, type: 'Withdrawal' } as Transaction)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'withdrawals (admin)'));

    return () => {
      unsubStats();
      unsubDeps();
      unsubWiths();
    };
  }, [profile.role, profile.email]);

  const handleUpdateTxId = async (id: string, newId: string) => {
    try {
      await setDoc(doc(db, 'deposits', id), { txId: newId }, { merge: true });
      alert("Transaction ID updated successfully");
    } catch (error) {
      console.error(error);
      alert("Error updating transaction ID");
    }
  };

  const handleAction = async (type: 'Deposit' | 'Withdrawal', tx: Transaction, action: 'approve' | 'reject') => {
    setIsProcessing(tx.id);
    try {
      const userRef = doc(db, 'users', tx.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) throw new Error("User not found");
      const userData = userSnap.data() as UserProfile;

      if (action === 'approve') {
        if (type === 'Deposit') {
          await setDoc(userRef, { balance: (userData.balance || 0) + tx.amount }, { merge: true });
          
          // Referral Reward (10% of first deposit)
          if (userData.referredBy) {
            const referrerRef = doc(db, 'users', userData.referredBy);
            const referrerSnap = await getDoc(referrerRef);
            if (referrerSnap.exists()) {
              const reward = tx.amount * 0.1;
              const referrerData = referrerSnap.data() as UserProfile;
              
              // Check if this is the user's first deposit
              const depositsSnap = await getDocs(query(collection(db, 'deposits'), where('uid', '==', tx.uid), where('status', '==', 'completed')));
              const isFirstDeposit = depositsSnap.empty;

              const batch = writeBatch(db);
              
              let newActiveCount = referrerData.activeReferralCount || 0;
              let totalBonus = 0;
              const claimedTiers = referrerData.claimedTiers || [];
              const newClaimedTiers = [...claimedTiers];

              if (isFirstDeposit) {
                newActiveCount += 1;
                
                // Check for tiered rewards
                REFERRAL_TIERS.forEach((tier, index) => {
                  if (newActiveCount >= tier.count && !claimedTiers.includes(index)) {
                    totalBonus += tier.reward;
                    newClaimedTiers.push(index);
                    
                    // Create a transaction for the tier bonus
                    batch.set(doc(collection(db, 'deposits')), {
                      uid: userData.referredBy,
                      amount: tier.reward,
                      type: 'Referral Reward',
                      status: 'completed',
                      createdAt: serverTimestamp(),
                      fromUser: `Tier: ${tier.name}`
                    });
                  }
                });
              }

              batch.update(referrerRef, {
                balance: (referrerData.balance || 0) + reward + totalBonus,
                totalReferralEarnings: (referrerData.totalReferralEarnings || 0) + reward + totalBonus,
                activeReferralCount: newActiveCount,
                claimedTiers: newClaimedTiers
              });
              
              batch.set(doc(collection(db, 'deposits')), {
                uid: userData.referredBy,
                amount: reward,
                type: 'Referral Reward',
                status: 'completed',
                createdAt: serverTimestamp(),
                fromUser: tx.uid
              });
              
              await batch.commit();
            }
          }
        } else if (type === 'Withdrawal') {
          if ((userData.balance || 0) < tx.amount) throw new Error("Insufficient user balance");
          await setDoc(userRef, { balance: (userData.balance || 0) - tx.amount }, { merge: true });
        }
        await setDoc(doc(db, type === 'Deposit' ? 'deposits' : 'withdrawals', tx.id), { status: 'completed' }, { merge: true });
      } else {
        await setDoc(doc(db, type === 'Deposit' ? 'deposits' : 'withdrawals', tx.id), { status: 'rejected' }, { merge: true });
      }
      alert(`Transaction ${action}ed successfully`);
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : "Error processing transaction");
    } finally {
      setIsProcessing(null);
    }
  };

  const handleProcessProfits = async () => {
    if (isProcessingProfits) return;
    setIsProcessingProfits(true);
    try {
      const investmentsSnap = await getDocs(query(collection(db, 'investments'), where('status', '==', 'active')));
      const now = Date.now();
      let processedCount = 0;

      for (const invDoc of investmentsSnap.docs) {
        const inv = invDoc.data();
        const lastClaim = inv.lastProfitClaimedAt?.toMillis() || inv.startDate?.toMillis() || now;
        const msElapsed = now - lastClaim;
        const daysElapsed = msElapsed / (24 * 60 * 60 * 1000);

        if (daysElapsed >= 0.01) { // Process even small amounts for demo (every ~15 mins)
          const dailyProfitAmt = (inv.amount * inv.dailyProfit) / 100;
          const totalNewProfit = dailyProfitAmt * daysElapsed;

          const userRef = doc(db, 'users', inv.uid);
          const userSnap = await getDoc(userRef);
          if (userSnap.exists()) {
            const userData = userSnap.data() as UserProfile;
            const batch = writeBatch(db);
            
            batch.update(userRef, {
              balance: userData.balance + totalNewProfit,
              totalProfit: userData.totalProfit + totalNewProfit
            });
            
            batch.update(doc(db, 'investments', invDoc.id), {
              lastProfitClaimedAt: serverTimestamp()
            });

            await batch.commit();
            processedCount++;
          }
        }
      }
      alert(`Processed profits for ${processedCount} active investments.`);
    } catch (error) {
      console.error(error);
      alert("Error processing profits");
    } finally {
      setIsProcessingProfits(false);
    }
  };

  return (
    <div className="space-y-8 mt-10">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="text-emerald-500 w-8 h-8" />
          <h2 className="text-2xl font-bold">Admin Management</h2>
        </div>
        <button 
          disabled={isProcessingProfits}
          onClick={handleProcessProfits}
          className="bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
        >
          {isProcessingProfits ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
          Process All Profits
        </button>
      </div>

      {/* Platform Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-card p-6 border-l-4 border-emerald-500">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center">
              <UserIcon className="text-emerald-500 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium uppercase tracking-wider">Total Users</p>
              <h4 className="text-2xl font-bold text-white">{stats.totalUsers}</h4>
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-blue-500">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">
              <DollarSign className="text-blue-500 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium uppercase tracking-wider">Total Invested</p>
              <h4 className="text-2xl font-bold text-white">${(stats.totalInvested || 0).toLocaleString()}</h4>
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-purple-500">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-500/10 rounded-xl flex items-center justify-center">
              <TrendingUp className="text-purple-500 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium uppercase tracking-wider">Total Profit</p>
              <h4 className="text-2xl font-bold text-white">${(stats.totalProfit || 0).toLocaleString()}</h4>
            </div>
          </div>
        </div>
        <div className="glass-card p-6 border-l-4 border-amber-500">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center">
              <Wallet className="text-amber-500 w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500 font-medium uppercase tracking-wider">User Balances</p>
              <h4 className="text-2xl font-bold text-white">${(stats.totalBalance || 0).toLocaleString()}</h4>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Pending Deposits */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <ArrowDownLeft className="w-5 h-5 text-emerald-500" /> Pending Deposits
          </h3>
          <div className="space-y-4">
            {pendingDeposits.length > 0 ? pendingDeposits.map(tx => (
              <div key={tx.id} className="p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">User: {tx.uid.slice(0, 8)}...</p>
                    <p className="text-xl font-mono font-bold text-emerald-400">${(tx.amount || 0).toLocaleString()}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <input 
                        type="text" 
                        defaultValue={tx.txId}
                        placeholder="Enter your transaction id"
                        onBlur={(e) => {
                          const newId = e.target.value;
                          if (newId !== tx.txId) {
                            handleUpdateTxId(tx.id, newId);
                          }
                        }}
                        className="bg-slate-950 border border-slate-800 p-1 rounded text-xs text-white w-32"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      disabled={!!isProcessing}
                      onClick={() => handleAction('Deposit', tx, 'approve')}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold rounded-lg transition-all"
                    >
                      Approve
                    </button>
                    <button 
                      disabled={!!isProcessing}
                      onClick={() => handleAction('Deposit', tx, 'reject')}
                      className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-all"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )) : <p className="text-slate-500 text-sm italic">No pending deposits</p>}
          </div>
        </div>

        {/* Pending Withdrawals */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
            <ArrowUpRight className="w-5 h-5 text-red-500" /> Pending Withdrawals
          </h3>
          <div className="space-y-4">
            {pendingWithdrawals.length > 0 ? pendingWithdrawals.map(tx => (
              <div key={tx.id} className="p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">User: {tx.uid.slice(0, 8)}...</p>
                    <p className="text-xl font-mono font-bold text-red-400">${(tx.amount || 0).toLocaleString()}</p>
                    <p className="text-[10px] text-slate-500 mt-1 break-all">Addr: {tx.address}</p>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      disabled={!!isProcessing}
                      onClick={() => handleAction('Withdrawal', tx, 'approve')}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold rounded-lg transition-all"
                    >
                      Approve
                    </button>
                    <button 
                      disabled={!!isProcessing}
                      onClick={() => handleAction('Withdrawal', tx, 'reject')}
                      className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-all"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )) : <p className="text-slate-500 text-sm italic">No pending withdrawals</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Constants ---
const USDT_ADDRESS = "TBWdYpJfKHvFjtYbfYHPiUN55Yp1qN1RpZ";
const MIN_WITHDRAWAL = 50;
const MAX_WITHDRAWAL = 50000;
const MIN_DEPOSIT = 30;
const MAX_DEPOSIT = 50000;

const PLANS: Plan[] = [
  {
    id: "basic",
    name: "Basic",
    minDeposit: 30,
    maxDeposit: 49,
    dailyProfit: 5.0,
    durationDays: 15,
    color: "from-slate-500 to-slate-700",
    description: "Ideal for beginners looking to explore the world of automated trading with minimal risk.",
    historicalPerformance: [
      { day: "Mon", profit: 4.8 },
      { day: "Tue", profit: 5.2 },
      { day: "Wed", profit: 5.0 },
      { day: "Thu", profit: 4.9 },
      { day: "Fri", profit: 5.1 },
      { day: "Sat", profit: 5.0 },
      { day: "Sun", profit: 5.0 }
    ],
    riskFactors: ["Market Volatility", "Platform Liquidity", "Standard Trading Risks"]
  },
  {
    id: "standard",
    name: "Standard",
    minDeposit: 50,
    maxDeposit: 99,
    dailyProfit: 5.5,
    durationDays: 20,
    color: "from-amber-500 to-orange-600",
    description: "A balanced plan for consistent growth, utilizing mid-frequency trading algorithms.",
    historicalPerformance: [
      { day: "Mon", profit: 5.3 },
      { day: "Tue", profit: 5.7 },
      { day: "Wed", profit: 5.5 },
      { day: "Thu", profit: 5.4 },
      { day: "Fri", profit: 5.6 },
      { day: "Sat", profit: 5.5 },
      { day: "Sun", profit: 5.5 }
    ],
    riskFactors: ["Algorithm Latency", "Exchange Connectivity", "Mid-level Market Fluctuations"]
  },
  {
    id: "starter",
    name: "Starter",
    minDeposit: 100,
    maxDeposit: 299,
    dailyProfit: 6.2,
    durationDays: 30,
    color: "from-emerald-500 to-teal-600",
    description: "Designed for serious investors seeking higher returns through advanced arbitrage strategies.",
    historicalPerformance: [
      { day: "Mon", profit: 6.0 },
      { day: "Tue", profit: 6.4 },
      { day: "Wed", profit: 6.2 },
      { day: "Thu", profit: 6.1 },
      { day: "Fri", profit: 6.3 },
      { day: "Sat", profit: 6.2 },
      { day: "Sun", profit: 6.2 }
    ],
    riskFactors: ["Arbitrage Spread Compression", "Network Congestion", "Execution Slippage"]
  },
  {
    id: "advanced",
    name: "Advanced",
    minDeposit: 300,
    maxDeposit: 499,
    dailyProfit: 7.5,
    durationDays: 30,
    color: "from-cyan-500 to-blue-600",
    description: "Leverages high-frequency trading and AI-driven market analysis for superior performance.",
    historicalPerformance: [
      { day: "Mon", profit: 7.2 },
      { day: "Tue", profit: 7.8 },
      { day: "Wed", profit: 7.5 },
      { day: "Thu", profit: 7.4 },
      { day: "Fri", profit: 7.6 },
      { day: "Sat", profit: 7.5 },
      { day: "Sun", profit: 7.5 }
    ],
    riskFactors: ["AI Model Drift", "High-Frequency Execution Risks", "Significant Market Shifts"]
  },
  {
    id: "pro",
    name: "Pro Growth",
    minDeposit: 500,
    maxDeposit: 699,
    dailyProfit: 9.0,
    durationDays: 45,
    color: "from-blue-500 to-indigo-600",
    description: "Professional grade investment plan with access to exclusive institutional trading pools.",
    historicalPerformance: [
      { day: "Mon", profit: 8.5 },
      { day: "Tue", profit: 9.5 },
      { day: "Wed", profit: 9.0 },
      { day: "Thu", profit: 8.8 },
      { day: "Fri", profit: 9.2 },
      { day: "Sat", profit: 9.0 },
      { day: "Sun", profit: 9.0 }
    ],
    riskFactors: ["Pool Liquidity Constraints", "Institutional Regulatory Changes", "Complex Derivative Risks"]
  },
  {
    id: "premium",
    name: "Premium",
    minDeposit: 700,
    maxDeposit: 899,
    dailyProfit: 12.0,
    durationDays: 45,
    color: "from-violet-500 to-purple-600",
    description: "Elite tier plan focusing on high-alpha opportunities in emerging digital asset markets.",
    historicalPerformance: [
      { day: "Mon", profit: 11.5 },
      { day: "Tue", profit: 12.5 },
      { day: "Wed", profit: 12.0 },
      { day: "Thu", profit: 11.8 },
      { day: "Fri", profit: 12.2 },
      { day: "Sat", profit: 12.0 },
      { day: "Sun", profit: 12.0 }
    ],
    riskFactors: ["Asset Specific Volatility", "Early Stage Project Risks", "Market Manipulation Vulnerabilities"]
  },
  {
    id: "elite",
    name: "Elite Wealth",
    minDeposit: 900,
    maxDeposit: 1000,
    dailyProfit: 15.5,
    durationDays: 60,
    color: "from-purple-500 to-pink-600",
    description: "Our most aggressive plan, utilizing leveraged trading and complex yield farming strategies.",
    historicalPerformance: [
      { day: "Mon", profit: 14.5 },
      { day: "Tue", profit: 16.5 },
      { day: "Wed", profit: 15.5 },
      { day: "Thu", profit: 15.0 },
      { day: "Fri", profit: 16.0 },
      { day: "Sat", profit: 15.5 },
      { day: "Sun", profit: 15.5 }
    ],
    riskFactors: ["Leverage Liquidation Risks", "Smart Contract Vulnerabilities", "Extreme Market Tail Risks"]
  }
];

const AuthModal = ({ isOpen, onClose, onAuthSuccess }: { isOpen: boolean, onClose: () => void, onAuthSuccess: () => void }) => {
  const [loading, setLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
      onAuthSuccess();
      onClose();
    } catch (error: any) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-card w-full max-w-md p-6 sm:p-8 relative overflow-hidden my-auto"
      >
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-emerald-400" />
        
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-white p-2">
          <X className="w-6 h-6" />
        </button>

        <div className="text-center mb-8">
          <TrendingUp className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
          <h2 className="text-3xl font-bold">Welcome to InvestPro</h2>
          <p className="text-slate-400 mt-2">Sign in with your Google account to start investing</p>
        </div>

        <button 
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full bg-white text-slate-950 font-bold py-4 rounded-xl transition-all hover:bg-slate-100 flex items-center justify-center gap-3 shadow-xl shadow-white/5"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
              Continue with Google
            </>
          )}
        </button>

        <p className="mt-8 text-center text-[10px] text-slate-500 uppercase tracking-widest font-bold">
          Secure • Encrypted • 24/7 Support
        </p>
      </motion.div>
    </div>
  );
};

const ErrorBoundary = ({ children }: { children: ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorInfo, setErrorInfo] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.error?.message?.startsWith('{')) {
        setHasError(true);
        setErrorInfo(event.error.message);
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    const info = errorInfo ? JSON.parse(errorInfo) : null;
    let userMessage = "An unexpected error occurred. Please try again later.";
    
    if (info?.error) {
      const errorStr = info.error.toLowerCase();
      if (errorStr.includes('insufficient permissions') || errorStr.includes('permission-denied')) {
        userMessage = "You don't have permission to perform this action. This might be due to security rules or your account status.";
      } else if (errorStr.includes('quota exceeded')) {
        userMessage = "The system is currently experiencing high traffic. Please try again in a few minutes.";
      } else if (errorStr.includes('offline')) {
        userMessage = "You appear to be offline. Please check your internet connection.";
      } else if (errorStr.includes('not-found')) {
        userMessage = "The requested resource was not found.";
      } else if (errorStr.includes('already-exists')) {
        userMessage = "This item already exists.";
      }
    }

    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="glass-card max-w-md w-full p-8 text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold mb-4">System Error</h2>
          <p className="text-slate-400 mb-6">{userMessage}</p>
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-emerald-500 rounded-xl font-bold hover:bg-emerald-600 transition-colors"
            >
              Reload Application
            </button>
            <button 
              onClick={() => setHasError(false)}
              className="w-full py-3 bg-slate-800 rounded-xl font-bold hover:bg-slate-700 transition-colors"
            >
              Dismiss
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-6 p-4 bg-black/50 rounded-lg text-left overflow-auto max-h-40">
              <code className="text-xs text-slate-500 break-all">{errorInfo}</code>
            </div>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const FAQSection = () => {
  const faqs = [
    {
      question: "How do I start investing?",
      answer: "To start investing, create an account, deposit funds into your wallet using the 'Deposit' button in your dashboard, and then choose an investment plan that suits your goals."
    },
    {
      question: "What is the minimum deposit amount?",
      answer: "The minimum deposit starts at $30 for our Basic plan. Each plan has its own minimum and maximum deposit limits."
    },
    {
      question: "How are profits calculated?",
      answer: "Profits are calculated daily based on your chosen plan's daily percentage rate. These profits are added to your balance and can be withdrawn or reinvested."
    },
    {
      question: "How long does a withdrawal take?",
      answer: "Withdrawal requests are typically processed within 24-48 hours. Once approved, the funds will be sent to your specified wallet address."
    },
    {
      question: "Is my investment secure?",
      answer: "We use advanced encryption and secure Firestore databases to protect your data. Our investment strategies are diversified to minimize risk and ensure consistent returns."
    }
  ];

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 bg-slate-900/20">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Frequently Asked Questions</h2>
          <p className="text-slate-400">Everything you need to know about our platform and investment process.</p>
        </div>
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div key={index} className="glass-card overflow-hidden">
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full p-6 text-left flex justify-between items-center hover:bg-white/5 transition-colors"
              >
                <span className="font-semibold text-lg">{faq.question}</span>
                <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${openIndex === index ? 'rotate-180' : ''}`} />
              </button>
              <motion.div
                initial={false}
                animate={{ height: openIndex === index ? 'auto' : 0 }}
                className="overflow-hidden"
              >
                <div className="p-6 pt-0 text-slate-400 leading-relaxed border-t border-white/5">
                  {faq.answer}
                </div>
              </motion.div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const TestimonialsSection = () => {
  const [showAllModal, setShowAllModal] = useState(false);

  const testimonials = [
    {
      name: "Sarah Johnson",
      role: "Crypto Investor",
      content: "I've been using this platform for 6 months and the returns have been consistent. The interface is clean and easy to use.",
      rating: 5,
      avatar: "https://picsum.photos/seed/sarah/100/100"
    },
    {
      name: "Michael Chen",
      role: "Financial Analyst",
      content: "The transparency and security measures here are top-notch. It's rare to find a platform that delivers on its promises so reliably.",
      rating: 5,
      avatar: "https://picsum.photos/seed/michael/100/100"
    },
    {
      name: "Elena Rodriguez",
      role: "Passive Income Seeker",
      content: "The customer support is excellent. They helped me through my first withdrawal and it was processed faster than expected.",
      rating: 4,
      avatar: "https://picsum.photos/seed/elena/100/100"
    },
    {
      name: "David Smith",
      role: "Day Trader",
      content: "The real-time updates and dashboard are very helpful. I can track my investments easily and the daily profit is always on time.",
      rating: 5,
      avatar: "https://picsum.photos/seed/david/100/100"
    },
    {
      name: "Amina Al-Farsi",
      role: "Business Owner",
      content: "A great way to diversify my portfolio. The platform feels secure and the plans are flexible enough for my needs.",
      rating: 5,
      avatar: "https://picsum.photos/seed/amina/100/100"
    },
    {
      name: "James Wilson",
      role: "Retiree",
      content: "I was skeptical at first, but the consistent returns have proven me wrong. It's a reliable source of passive income.",
      rating: 4,
      avatar: "https://picsum.photos/seed/james/100/100"
    }
  ];

  const allTestimonials = [
    ...testimonials,
    {
      name: "Robert Taylor",
      role: "Software Engineer",
      content: "The API integration options for advanced users are fantastic. Very well-documented and stable.",
      rating: 5,
      avatar: "https://picsum.photos/seed/robert/100/100"
    },
    {
      name: "Linda Garcia",
      role: "Marketing Director",
      content: "I love the referral program. It's a great way to earn extra while sharing a platform I actually use and trust.",
      rating: 5,
      avatar: "https://picsum.photos/seed/linda/100/100"
    },
    {
      name: "Kevin Lee",
      role: "Student",
      content: "Even with a small budget, I was able to start with the Basic plan. It's been a great learning experience in crypto.",
      rating: 4,
      avatar: "https://picsum.photos/seed/kevin/100/100"
    },
    {
      name: "Sophia Wang",
      role: "E-commerce Specialist",
      content: "Fast deposits and even faster withdrawals. The USDT TRC20 support is a game changer for low fees.",
      rating: 5,
      avatar: "https://picsum.photos/seed/sophia/100/100"
    }
  ];

  return (
    <section id="reviews" className="py-24 bg-slate-950 border-t border-slate-900">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between items-end mb-16 gap-8">
          <div className="max-w-2xl">
            <h2 className="text-4xl md:text-5xl font-bold mb-6">Member Ratings & Reviews</h2>
            <p className="text-xl text-slate-400">Join over 50,000+ active investors who trust our platform for their financial growth.</p>
          </div>
          <div className="flex items-center gap-6 bg-slate-900/50 p-6 rounded-3xl border border-slate-800">
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-1">4.8</div>
              <div className="flex gap-1 justify-center mb-1">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className={`w-4 h-4 ${i < 4 ? 'text-yellow-500 fill-yellow-500' : 'text-yellow-500/30'}`} />
                ))}
              </div>
              <div className="text-xs text-slate-500 uppercase tracking-widest font-bold">Average Rating</div>
            </div>
            <div className="w-px h-12 bg-slate-800" />
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-1">12k+</div>
              <div className="text-xs text-slate-500 uppercase tracking-widest font-bold">Total Reviews</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {testimonials.map((t, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              whileHover={{ y: -5 }}
              className="glass-card p-8 flex flex-col h-full group"
            >
              <div className="flex gap-1 mb-6">
                {[...Array(5)].map((StarIcon, starI) => (
                  <Star key={starI} className={`w-4 h-4 ${starI < t.rating ? 'text-yellow-500 fill-yellow-500' : 'text-slate-700'}`} />
                ))}
              </div>
              <p className="text-slate-300 text-lg leading-relaxed mb-8 flex-grow">"{t.content}"</p>
              <div className="flex items-center gap-4 pt-6 border-t border-slate-800/50">
                <div className="relative">
                  <img src={t.avatar} alt={t.name} className="w-14 h-14 rounded-2xl object-cover grayscale group-hover:grayscale-0 transition-all duration-500" referrerPolicy="no-referrer" />
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-4 border-slate-900 flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                </div>
                <div>
                  <h4 className="font-bold text-white text-lg">{t.name}</h4>
                  <p className="text-sm text-slate-500 font-medium">{t.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <button 
            onClick={() => setShowAllModal(true)}
            className="px-8 py-4 bg-slate-900 hover:bg-slate-800 text-white border border-slate-800 rounded-2xl font-bold transition-all inline-flex items-center gap-2"
          >
            View All Reviews <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <Modal 
          isOpen={showAllModal} 
          onClose={() => setShowAllModal(false)} 
          title="All Member Reviews"
        >
          <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
            {allTestimonials.map((t, i) => (
              <div key={i} className="p-6 bg-slate-900/50 rounded-2xl border border-slate-800 flex flex-col gap-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4">
                    <img src={t.avatar} alt={t.name} className="w-12 h-12 rounded-xl object-cover" referrerPolicy="no-referrer" />
                    <div>
                      <h4 className="font-bold text-white">{t.name}</h4>
                      <p className="text-xs text-slate-500">{t.role}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {[...Array(5)].map((_, starI) => (
                      <Star key={starI} className={`w-3 h-3 ${starI < t.rating ? 'text-yellow-500 fill-yellow-500' : 'text-slate-700'}`} />
                    ))}
                  </div>
                </div>
                <p className="text-slate-400 text-sm italic">"{t.content}"</p>
              </div>
            ))}
          </div>
        </Modal>
      </div>
    </section>
  );
};

const Navbar = ({ user, onOpenAuth, onOpenDashboard, onLogout }: { user: User | null, onOpenAuth: () => void, onOpenDashboard: (tab?: 'dashboard' | 'investments' | 'transactions' | 'referrals', deposit?: boolean) => void, onLogout: () => void }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled || isMobileMenuOpen ? "bg-slate-950/90 backdrop-blur-lg border-b border-slate-800 py-3" : "bg-transparent py-6"}`}>
      <div className="max-w-7xl mx-auto px-6 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <TrendingUp className="text-white w-6 h-6" />
          </div>
          <span className="text-xl font-bold tracking-tight">CryptoInvest<span className="text-emerald-500">Pro</span></span>
        </div>
        
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-400">
          <a href="#plans" className="hover:text-emerald-400 transition-colors">Plans</a>
          <a href="#calculator" className="hover:text-emerald-400 transition-colors">Calculator</a>
          <a href="#security" className="hover:text-emerald-400 transition-colors">Security</a>
          <a href="#faq" className="hover:text-emerald-400 transition-colors">FAQ</a>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-4">
            {user ? (
              <>
                <button onClick={onLogout} className="p-2 text-slate-400 hover:text-red-400 transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </>
            ) : (
              <button 
                onClick={onOpenAuth}
                className="bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-2.5 rounded-full text-sm font-semibold transition-all flex items-center gap-2"
              >
                <LogIn className="w-4 h-4" />
                Login
              </button>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 text-slate-400 hover:text-white transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-slate-800 bg-slate-950/95 backdrop-blur-xl overflow-hidden"
          >
            <div className="px-6 py-8 space-y-6">
              <div className="flex flex-col gap-4">
                <a 
                  href="#plans" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg font-medium text-slate-300 hover:text-emerald-400 transition-colors"
                >
                  Investment Plans
                </a>
                <a 
                  href="#calculator" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg font-medium text-slate-300 hover:text-emerald-400 transition-colors"
                >
                  Calculator
                </a>
                <a 
                  href="#security" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg font-medium text-slate-300 hover:text-emerald-400 transition-colors"
                >
                  Security & Trust
                </a>
                <a 
                  href="#faq" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="text-lg font-medium text-slate-300 hover:text-emerald-400 transition-colors"
                >
                  FAQ
                </a>
              </div>

              <div className="pt-6 border-t border-slate-800">
                {user ? (
                  <div className="space-y-3">
                    <button 
                      onClick={() => {
                        onOpenDashboard('dashboard', true);
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full bg-emerald-500 text-white py-3 px-4 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                    >
                      <Plus className="w-5 h-5" />
                      Deposit Funds
                    </button>
                    <button 
                      onClick={() => {
                        onOpenDashboard('investments');
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full bg-slate-900 text-white py-3 px-4 rounded-xl font-semibold flex items-center gap-3 border border-slate-800"
                    >
                      <Briefcase className="w-5 h-5 text-emerald-500" />
                      My Investments
                    </button>
                    <button 
                      onClick={() => {
                        onOpenDashboard('transactions');
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full bg-slate-900 text-white py-3 px-4 rounded-xl font-semibold flex items-center gap-3 border border-slate-800"
                    >
                      <History className="w-5 h-5 text-emerald-500" />
                      Transactions
                    </button>
                    <button 
                      onClick={() => {
                        onOpenDashboard('referrals');
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full bg-slate-900 text-white py-3 px-4 rounded-xl font-semibold flex items-center gap-3 border border-slate-800"
                    >
                      <Users className="w-5 h-5 text-emerald-500" />
                      Referrals
                    </button>
                    <button 
                      onClick={() => {
                        onLogout();
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full bg-slate-900/50 text-red-400 py-3 px-4 rounded-xl font-semibold flex items-center gap-3 border border-red-500/20 mt-4"
                    >
                      <LogOut className="w-5 h-5" />
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => {
                      onOpenAuth();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full bg-emerald-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-5 h-5" />
                    Login / Register
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

const Hero = ({ onGetStarted, onDeposit, user }: { onGetStarted: () => void, onDeposit: () => void, user: User | null }) => (
  <section className="relative pt-16 pb-10 overflow-hidden">
    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10">
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/10 blur-[120px] rounded-full" />
    </div>
    
    <div className="max-w-7xl mx-auto px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <span className="inline-block py-1 px-3 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-widest mb-3">
          The Future of Wealth
        </span>
        <h1 className="text-3xl md:text-6xl font-extrabold mb-4 tracking-tight leading-tight">
          Grow Your Crypto <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500">
            With Professional Precision
          </span>
        </h1>
        <p className="text-slate-400 text-sm md:text-lg max-w-2xl mx-auto mb-6 leading-relaxed">
          Secure, transparent, and high-yield investment plans tailored for the modern crypto investor. Start your journey to financial freedom today.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button 
            onClick={onGetStarted}
            className="bg-emerald-500 hover:bg-emerald-400 text-white px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 group text-sm"
          >
            {user ? 'Go to Dashboard' : 'Get Started Now'}
            <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
          <button 
            onClick={onDeposit}
            className="bg-slate-900 hover:bg-slate-800 border border-slate-800 px-6 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-sm"
          >
            <ArrowDownLeft className="w-4 h-4" />
            Deposit
          </button>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-4 opacity-60">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider">10% Referral Bonus</span>
          </div>
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-blue-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Tiered Reward System</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-purple-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Secure & Transparent</span>
          </div>
        </div>
      </motion.div>
    </div>
  </section>
);

const PlanDetailsModal = ({ plan, isOpen, onClose, onInvest }: { plan: Plan, isOpen: boolean, onClose: () => void, onInvest: (plan: Plan) => void }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          <button 
            onClick={onClose}
            className="absolute top-6 right-6 p-2 bg-slate-800 hover:bg-slate-700 rounded-full transition-colors z-10"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Left Side: Info */}
            <div className="p-8 lg:p-12">
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r ${plan.color} text-white text-xs font-bold uppercase tracking-widest mb-6`}>
                {plan.id} Plan
              </div>
              
              <h2 className="text-3xl md:text-4xl font-bold mb-4">{plan.name}</h2>
              <p className="text-slate-400 text-lg leading-relaxed mb-8">
                {plan.description}
              </p>

              <div className="grid grid-cols-2 gap-6 mb-8">
                <div className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
                  <div className="text-slate-500 text-xs uppercase font-bold mb-1">Daily Profit</div>
                  <div className="text-2xl font-bold text-emerald-400">{plan.dailyProfit}%</div>
                </div>
                <div className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
                  <div className="text-slate-500 text-xs uppercase font-bold mb-1">Duration</div>
                  <div className="text-2xl font-bold text-blue-400">{plan.durationDays} Days</div>
                </div>
                <div className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
                  <div className="text-slate-500 text-xs uppercase font-bold mb-1">Min Deposit</div>
                  <div className="text-2xl font-bold text-white">${plan.minDeposit}</div>
                </div>
                <div className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
                  <div className="text-slate-500 text-xs uppercase font-bold mb-1">Max Deposit</div>
                  <div className="text-2xl font-bold text-white">${plan.maxDeposit}</div>
                </div>
              </div>

              <button
                onClick={() => {
                  onInvest(plan);
                  onClose();
                }}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/20"
              >
                Invest Now
              </button>
            </div>

            {/* Right Side: Charts & Risks */}
            <div className="p-8 lg:p-12 bg-slate-950/50">
              <h3 className="text-lg font-bold mb-6">Historical Performance</h3>
              <div className="h-64 mb-12">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={plan.historicalPerformance}>
                    <defs>
                      <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="day" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }}
                    />
                    <Area type="monotone" dataKey="profit" stroke="#10b981" fillOpacity={1} fill="url(#colorProfit)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                Risk Factors
              </h3>
              <ul className="space-y-3">
                {plan.riskFactors.map((risk, index) => (
                  <li key={index} className="flex items-start gap-3 text-slate-400 text-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 flex-shrink-0" />
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};


const InfoTooltip = ({ text, children }: { text: string, children: ReactNode }) => (
  <div className="relative group">
    {children}
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50">
      {text}
    </div>
  </div>
);

const PlanCard = ({ plan, onInvest, onClick }: { plan: Plan, onInvest: (plan: Plan) => void, onClick: () => void }) => (
  <motion.div 
    whileHover={{ y: -5 }}
    onClick={onClick}
    className="glass-card p-4 sm:p-6 relative overflow-hidden group cursor-pointer"
  >
    <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${plan.color} opacity-10 blur-3xl group-hover:opacity-20 transition-opacity`} />
    
    <h3 className="text-lg sm:text-xl font-bold mb-1">{plan.name}</h3>
    <div className="flex items-baseline gap-1 mb-3 sm:mb-4">
      <span className="text-2xl sm:text-3xl font-extrabold text-emerald-400">{plan.dailyProfit}%</span>
      <span className="text-slate-500 text-[10px] sm:text-xs">/ Daily</span>
    </div>

    <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
      <div className="flex justify-between items-center text-[10px] sm:text-xs">
        <InfoTooltip text="The minimum amount you can deposit for this plan.">
          <span className="text-slate-400 cursor-help underline decoration-dotted">Min Deposit</span>
        </InfoTooltip>
        <span className="font-mono text-emerald-400">${plan.minDeposit}</span>
      </div>
      <div className="flex justify-between items-center text-[10px] sm:text-xs">
        <InfoTooltip text="The maximum amount you can deposit for this plan.">
          <span className="text-slate-400 cursor-help underline decoration-dotted">Max Deposit</span>
        </InfoTooltip>
        <span className="font-mono text-emerald-400">${(plan.maxDeposit || 0).toLocaleString()}</span>
      </div>
      <div className="flex justify-between items-center text-[10px] sm:text-xs">
        <InfoTooltip text="The duration of the investment in days.">
          <span className="text-slate-400 cursor-help underline decoration-dotted">Duration</span>
        </InfoTooltip>
        <span className="font-semibold">{plan.durationDays} Days</span>
      </div>
      <div className="flex justify-between items-center text-[10px] sm:text-xs">
        <InfoTooltip text="The total percentage return you will get at the end of the duration.">
          <span className="text-slate-400 cursor-help underline decoration-dotted">Total Return</span>
        </InfoTooltip>
        <span className="font-bold text-emerald-400">{plan.dailyProfit * plan.durationDays}%</span>
      </div>
    </div>

    <button 
      onClick={() => onInvest(plan)}
      className={`w-full py-2 sm:py-3 rounded-lg font-bold bg-gradient-to-r ${plan.color} text-white text-xs sm:text-sm shadow-lg shadow-emerald-500/10 hover:scale-[1.02] active:scale-[0.98] transition-all`}
    >
      Invest Now
    </button>
  </motion.div>
);

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass-card w-full max-w-md p-6 sm:p-8 relative z-10 my-auto"
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl sm:text-2xl font-bold">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
};

const Dashboard = ({ isOpen, onClose, user, profile, transactions, initialDepositOpen, initialTab }: { isOpen: boolean, onClose: () => void, user: User, profile: UserProfile | null, transactions: Transaction[], initialDepositOpen?: boolean, initialTab?: 'dashboard' | 'investments' | 'transactions' | 'referrals' | 'calculator' | 'support' }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'investments' | 'transactions' | 'referrals' | 'calculator' | 'support' | 'profile'>(initialTab || 'dashboard');
  const [isDepositOpen, setIsDepositOpen] = useState(initialDepositOpen || false);
  const [isChatActive, setIsChatActive] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<{role: 'user' | 'agent', text: string}[]>([]);
  const [isAgentTyping, setIsAgentTyping] = useState(false);

  useEffect(() => {
    if (initialDepositOpen && isOpen) {
      setIsDepositOpen(true);
    }
  }, [initialDepositOpen, isOpen]);

  useEffect(() => {
    if (initialTab && isOpen) {
      setActiveTab(initialTab);
    }
  }, [initialTab, isOpen]);

  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [txHash, setTxHash] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWaitingForConfirmation, setIsWaitingForConfirmation] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newUsername, setNewUsername] = useState(profile?.username || "");
  const [referredUsers, setReferredUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users'), where('referredBy', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      setReferredUsers(snap.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile)));
    });
    return () => unsub();
  }, [user]);

  const handleClaimTier = async (tierIndex: number) => {
    if (!profile) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        claimedTiers: [...(profile.claimedTiers || []), tierIndex],
        balance: (profile.balance || 0) + REFERRAL_TIERS[tierIndex].reward
      });
      alert("Tier claimed successfully!");
    } catch (error) {
      console.error(error);
      alert("Error claiming tier");
    }
  };

  const handleUpdateProfile = async () => {
    if (!newUsername.trim()) return;
    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), { username: newUsername.trim() });
      setIsEditing(false);
      alert("Username updated successfully.");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(USDT_ADDRESS);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWithdraw = async (e: FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(withdrawAmount);
    if (amt < MIN_WITHDRAWAL || amt > MAX_WITHDRAWAL) {
      alert(`Withdrawal must be between $${MIN_WITHDRAWAL} and $${MAX_WITHDRAWAL}`);
      return;
    }
    if (!profile || amt > profile.balance) {
      alert("Insufficient balance");
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'withdrawals'), {
        uid: user.uid,
        amount: amt,
        address: withdrawAddress,
        status: 'pending',
        createdAt: serverTimestamp()
      });
      alert(`Withdrawal request of $${amt} submitted successfully.`);
      setIsWithdrawOpen(false);
      setWithdrawAmount("");
      setWithdrawAddress("");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'withdrawals');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    const userMsg = chatMessage.trim();
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatMessage("");
    setIsAgentTyping(true);

    // Simulate agent response
    setTimeout(() => {
      setIsAgentTyping(false);
      setChatHistory(prev => [...prev, { 
        role: 'agent', 
        text: "Thank you for contacting support. An agent will be with you shortly to assist with your inquiry. Please stay online." 
      }]);
    }, 1500);
  };

  const handleDepositSubmit = async () => {
    const amt = parseFloat(depositAmount);
    if (depositAmount && (amt < MIN_DEPOSIT || amt > MAX_DEPOSIT)) {
      alert(`Deposit must be between $${MIN_DEPOSIT} and $${MAX_DEPOSIT}`);
      return;
    }
    if (!txHash.trim()) {
      alert("Please enter a transaction hash.");
      return;
    }
    
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'deposits'), {
        uid: user.uid,
        amount: amt,
        txHash: txHash.trim(),
        status: 'pending',
        createdAt: serverTimestamp()
      });
      setIsWaitingForConfirmation(true);
      setDepositAmount("");
      setTxHash("");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'deposits');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-0 md:p-6 lg:p-10">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full h-full md:max-w-6xl md:max-h-[90vh] bg-slate-950 md:rounded-3xl overflow-hidden flex flex-col md:flex-row shadow-2xl border border-slate-800"
      >
        {/* Sidebar */}
        <div className="w-full md:w-60 border-b md:border-b-0 md:border-r border-slate-800 p-4 md:p-5 flex flex-col bg-slate-900/50">
          <div className="flex items-center justify-between md:block mb-4 md:mb-8">
            <div className="flex items-center gap-2">
              <TrendingUp className="text-emerald-500 w-6 h-6" />
              <span className="text-lg font-bold">InvestPro</span>
            </div>
            <button onClick={onClose} className="md:hidden p-2 text-slate-400 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 no-scrollbar">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'dashboard' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-900'}`}
            >
              <LayoutDashboard className="w-4 h-4" /> Dashboard
            </button>
            <button 
              onClick={() => setIsDepositOpen(true)}
              className={`flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors text-slate-400 hover:bg-slate-900 whitespace-nowrap`}
            >
              <ArrowDownLeft className="w-4 h-4" /> Deposit
            </button>
            <button 
              onClick={() => setActiveTab('investments')}
              className={`flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'investments' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-900'}`}
            >
              <PieChart className="w-4 h-4" /> Investments
            </button>
            <button 
              onClick={() => setActiveTab('transactions')}
              className={`flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'transactions' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-900'}`}
            >
              <History className="w-4 h-4" /> Transactions
            </button>
            <button 
              onClick={() => setActiveTab('referrals')}
              className={`flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'referrals' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-900'}`}
            >
              <UserIcon className="w-4 h-4" /> Referrals
            </button>
            <button 
              onClick={() => setActiveTab('support')}
              className={`flex-shrink-0 md:w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${activeTab === 'support' ? 'bg-emerald-500/10 text-emerald-400' : 'text-slate-400 hover:bg-slate-900'}`}
            >
              <Headphones className="w-4 h-4" /> Support
            </button>
          </nav>

          <div className="mt-auto pt-4 hidden md:block space-y-1">
            <button 
              onClick={onClose}
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:text-white hover:bg-slate-900 transition-colors"
            >
              <X className="w-4 h-4" /> Close Panel
            </button>
            <button 
              onClick={() => { logout(); onClose(); }} 
              className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Logout
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-5 md:p-8">
          <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold mb-0.5">Welcome, {profile?.username || user.displayName?.split(' ')[0] || user.email?.split('@')[0]}</h1>
              <p className="text-slate-500 text-xs">Portfolio overview and management.</p>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsDepositOpen(true)}
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-3.5 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 text-xs"
              >
                <ArrowDownLeft className="w-3.5 h-3.5" />
                Deposit
              </button>
              <button 
                onClick={() => setIsWithdrawOpen(true)}
                className="bg-slate-800 hover:bg-slate-700 text-white px-3.5 py-1.5 rounded-lg font-medium transition-colors border border-slate-700 flex items-center gap-1.5 text-xs"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Withdraw
              </button>
              <div className="hidden sm:flex items-center gap-2 bg-slate-900 border border-slate-800 p-1 pr-3 rounded-full ml-2">
                <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-xs uppercase">
                  {(profile?.username || user.email || "U")[0]}
                </div>
                <span className="text-xs font-semibold">{profile?.username || user.email?.split('@')[0]}</span>
              </div>
            </div>
          </header>

          {activeTab === 'dashboard' && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div className="glass-card p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div className="p-2 bg-emerald-500/10 rounded-lg">
                      <Wallet className="text-emerald-500 w-5 h-5" />
                    </div>
                  </div>
                  <p className="text-slate-500 text-xs mb-0.5">Total Balance</p>
                  <h2 className="text-2xl font-mono font-bold">${(profile?.balance || 0).toFixed(2)}</h2>
                </div>
                
                <div className="glass-card p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div className="p-2 bg-blue-500/10 rounded-lg">
                      <TrendingUp className="text-blue-500 w-5 h-5" />
                    </div>
                  </div>
                  <p className="text-slate-500 text-xs mb-0.5">Total Invested</p>
                  <h2 className="text-2xl font-mono font-bold">${(profile?.totalInvested || 0).toFixed(2)}</h2>
                </div>

                <div className="glass-card p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div className="p-2 bg-purple-500/10 rounded-lg">
                      <Zap className="text-purple-500 w-5 h-5" />
                    </div>
                  </div>
                  <p className="text-slate-500 text-xs mb-0.5">Total Profit</p>
                  <h2 className="text-2xl font-mono font-bold text-emerald-400">+${(profile?.totalProfit || 0).toFixed(2)}</h2>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 mb-8">
                <button 
                  onClick={() => setIsDepositOpen(true)}
                  className="flex-1 min-w-[160px] bg-emerald-500 hover:bg-emerald-400 text-white p-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 text-sm"
                >
                  <ArrowDownLeft className="w-5 h-5" />
                  Deposit Funds
                </button>
                <button 
                  onClick={() => setIsWithdrawOpen(true)}
                  className="flex-1 min-w-[160px] bg-slate-900 hover:bg-slate-800 border border-slate-800 text-white p-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <ArrowUpRight className="w-5 h-5" />
                  Withdraw Profit
                </button>
              </div>

              {/* Recent Activity */}
              <div className="glass-card p-6">
                <h3 className="text-lg font-bold mb-4">Recent Transactions</h3>
                <div className="space-y-4">
                  {transactions.slice(0, 5).length > 0 ? transactions.slice(0, 5).map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between py-3 border-b border-slate-800 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-800 rounded-lg">
                          {tx.type === 'Deposit' ? <ArrowDownLeft className="w-4 h-4" /> : tx.type === 'Withdrawal' ? <ArrowUpRight className="w-4 h-4" /> : tx.type === 'Investment' ? <PieChart className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
                        </div>
                        <div>
                          <p className="font-bold text-sm">{tx.type}</p>
                          <p className="text-[10px] text-slate-500">{tx.createdAt?.toDate().toLocaleDateString() || "Processing..."}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-mono font-bold text-sm ${tx.type === 'Withdrawal' || tx.type === 'Investment' ? 'text-red-400' : 'text-emerald-400'}`}>
                          {tx.type === 'Withdrawal' || tx.type === 'Investment' ? '-' : '+'}${(tx.amount || 0).toLocaleString()}
                        </p>
                        <InfoTooltip text={`Transaction status is ${tx.status}.`}>
                          <p className={`text-[10px] cursor-help ${tx.status === 'completed' || tx.status === 'active' ? 'text-emerald-500' : tx.status === 'pending' ? 'text-yellow-500' : 'text-red-500'}`}>
                            {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                          </p>
                        </InfoTooltip>
                      </div>
                    </div>
                  )) : (
                    <div className="text-center py-8 text-slate-500 text-sm">No transactions yet.</div>
                  )}
                </div>
              </div>

            {/* Admin Section */}
            {(profile?.role === 'admin' || profile?.email === "haseeb.ali.punjab1515@gmail.com") && <AdminPanel profile={profile} />}
          </>
        )}

        {activeTab === 'investments' && (
          <div className="glass-card p-8">
            <h3 className="text-xl font-bold mb-6">My Investments</h3>
            <div className="space-y-6">
              {transactions.filter(tx => tx.type === 'Investment').length > 0 ? transactions.filter(tx => tx.type === 'Investment').map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-4 border-b border-slate-800 last:border-0">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-slate-800 rounded-xl">
                      <PieChart className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold">{tx.type}</p>
                      <p className="text-xs text-slate-500">{tx.createdAt?.toDate().toLocaleDateString() || "Processing..."}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-bold text-emerald-400">
                      ${(tx.amount || 0).toLocaleString()}
                    </p>
                    <p className={`text-xs ${tx.status === 'completed' || tx.status === 'active' ? 'text-emerald-500' : tx.status === 'pending' ? 'text-yellow-500' : 'text-red-500'}`}>
                      {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                    </p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-10 text-slate-500">No investments yet.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="glass-card p-8">
            <h3 className="text-xl font-bold mb-6">My Profile</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Username</label>
                {isEditing ? (
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newUsername} 
                      onChange={(e) => setNewUsername(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white"
                    />
                    <button onClick={handleUpdateProfile} className="bg-emerald-500 text-white px-4 py-2 rounded-lg font-bold">Save</button>
                  </div>
                ) : (
                  <div className="flex justify-between items-center bg-slate-900 border border-slate-700 rounded-lg px-4 py-2">
                    <span className="text-white">{profile?.username || user.displayName || "Not set"}</span>
                    <button onClick={() => setIsEditing(true)} className="text-emerald-400 text-sm font-bold">Edit</button>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">Email</label>
                <div className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-slate-500">
                  {user.email}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                  <p className="text-slate-500 text-xs mb-1">Balance</p>
                  <h2 className="text-xl font-bold">${(profile?.balance || 0).toFixed(2)}</h2>
                </div>
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
                  <p className="text-slate-500 text-xs mb-1">Total Profit</p>
                  <h2 className="text-xl font-bold text-emerald-400">${(profile?.totalProfit || 0).toFixed(2)}</h2>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'transactions' && (
          <div className="glass-card p-8">
            <h3 className="text-xl font-bold mb-6">All Transactions</h3>
            <div className="space-y-6">
              {transactions.length > 0 ? transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-4 border-b border-slate-800 last:border-0">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-slate-800 rounded-xl">
                      {tx.type === 'Deposit' ? <ArrowDownLeft className="w-5 h-5" /> : tx.type === 'Withdrawal' ? <ArrowUpRight className="w-5 h-5" /> : tx.type === 'Investment' ? <PieChart className="w-5 h-5" /> : <TrendingUp className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-bold">{tx.type}</p>
                      <p className="text-xs text-slate-500">{tx.createdAt?.toDate().toLocaleDateString() || "Processing..."}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-mono font-bold ${tx.type === 'Withdrawal' || tx.type === 'Investment' ? 'text-red-400' : 'text-emerald-400'}`}>
                      {tx.type === 'Withdrawal' || tx.type === 'Investment' ? '-' : '+'}${tx.amount.toLocaleString()}
                    </p>
                    <p className={`text-xs ${tx.status === 'completed' || tx.status === 'active' ? 'text-emerald-500' : tx.status === 'pending' ? 'text-yellow-500' : 'text-red-500'}`}>
                      {tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
                    </p>
                  </div>
                </div>
              )) : (
                <div className="text-center py-10 text-slate-500">No transactions yet.</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'referrals' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="glass-card p-6 border-l-4 border-emerald-500">
                <p className="text-slate-500 text-sm mb-1 uppercase tracking-wider font-bold">Total Referrals</p>
                <h2 className="text-3xl md:text-4xl font-bold">{profile?.referralCount || 0}</h2>
              </div>
              <div className="glass-card p-6 border-l-4 border-blue-500">
                <p className="text-slate-500 text-sm mb-1 uppercase tracking-wider font-bold">Active Referrals</p>
                <h2 className="text-3xl md:text-4xl font-bold text-blue-400">{profile?.activeReferralCount || 0}</h2>
              </div>
              <div className="glass-card p-6 border-l-4 border-purple-500">
                <p className="text-slate-500 text-sm mb-1 uppercase tracking-wider font-bold">Total Earnings</p>
                <h2 className="text-3xl md:text-4xl font-bold text-emerald-400">${(profile?.totalReferralEarnings || 0).toFixed(2)}</h2>
              </div>
            </div>

            {/* Progress Tracker */}
            <div className="glass-card p-8">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                <TrendingUp className="text-emerald-500 w-6 h-6" /> Referral Milestones
              </h3>
              
              {(() => {
                const activeCount = profile?.activeReferralCount || 0;
                const nextTier = REFERRAL_TIERS.find(t => activeCount < t.count) || REFERRAL_TIERS[REFERRAL_TIERS.length - 1];
                const nextTierIndex = REFERRAL_TIERS.indexOf(nextTier);
                const prevTierCount = nextTierIndex > 0 ? REFERRAL_TIERS[nextTierIndex - 1].count : 0;
                
                const isMaxTier = activeCount >= REFERRAL_TIERS[REFERRAL_TIERS.length - 1].count;
                const progress = isMaxTier ? 100 : Math.min(100, ((activeCount - prevTierCount) / (nextTier.count - prevTierCount)) * 100);
                
                return (
                  <div className="space-y-6">
                    <div className="flex justify-between items-end mb-2">
                      <div>
                        <p className="text-slate-400 text-sm">
                          {isMaxTier ? 'All Milestones Reached!' : `Next Milestone: ${nextTier.name}`}
                        </p>
                        {!isMaxTier && <p className="text-2xl font-bold text-emerald-400">${nextTier.reward} Bonus</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-slate-400 text-sm">Progress</p>
                        <p className="text-xl font-bold">{activeCount} / {isMaxTier ? activeCount : nextTier.count}</p>
                      </div>
                    </div>
                    
                    <div className="h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${progress}%` }}
                        className="h-full bg-gradient-to-r from-emerald-500 to-blue-500 shadow-lg shadow-emerald-500/20"
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 pt-4">
                      {REFERRAL_TIERS.map((tier, index) => {
                        const isClaimed = profile?.claimedTiers?.includes(index);
                        const isReached = activeCount >= tier.count;
                        
                        return (
                          <div key={index} className={`p-4 rounded-xl border transition-all ${isReached ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-slate-900/50 border-slate-800'}`}>
                            <InfoTooltip text={`Reach ${tier.count} referrals to earn $${tier.reward} reward.`}>
                              <div className="cursor-help">
                                <div className="flex justify-between items-start mb-2">
                                  <Star className={`w-4 h-4 ${isReached ? 'text-emerald-400 fill-emerald-400' : 'text-slate-600'}`} />
                                  {isClaimed && <Check className="w-4 h-4 text-emerald-400" />}
                                </div>
                                <p className={`text-[10px] font-bold uppercase tracking-wider ${isReached ? 'text-emerald-400' : 'text-slate-500'}`}>{tier.name}</p>
                                <p className="text-lg font-bold">${tier.reward}</p>
                                <p className="text-[10px] text-slate-500">{tier.count} Referrals</p>
                                {isReached && !isClaimed && (
                                  <button
                                    onClick={() => handleClaimTier(index)}
                                    className="mt-2 w-full bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-bold py-1 rounded transition-all"
                                  >
                                    Claim
                                  </button>
                                )}
                              </div>
                            </InfoTooltip>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="glass-card p-8">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Zap className="text-emerald-500 w-6 h-6" /> Your Referral Link
              </h3>
              <p className="text-slate-400 mb-6">Invite your friends and earn <span className="text-emerald-400 font-bold">10% commission</span> on their first deposit + <span className="text-blue-400 font-bold">Tiered Bonuses</span>!</p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1 bg-slate-950 border border-slate-800 p-4 rounded-xl font-mono text-sm text-slate-300 break-all">
                  {window.location.origin}?ref={user.uid}
                </div>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}?ref=${user.uid}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white px-8 py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
            </div>

            <div className="glass-card p-8">
              <h3 className="text-xl font-bold mb-6">Referred Users</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-400">
                  <thead className="text-xs uppercase bg-slate-900 text-slate-300">
                    <tr>
                      <th className="px-6 py-3">User</th>
                      <th className="px-6 py-3">Sign-up Date</th>
                      <th className="px-6 py-3">First Deposit Made</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referredUsers.map(u => (
                      <tr key={u.uid} className="border-b border-slate-800">
                        <td className="px-6 py-4 font-medium text-white">{u.email}</td>
                        <td className="px-6 py-4">{u.createdAt?.toDate().toLocaleDateString()}</td>
                        <td className="px-6 py-4">{(u.totalInvested || 0) > 0 ? 'Yes' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="glass-card p-6">
              <h3 className="text-xl font-bold mb-6">Referral History</h3>
              <div className="space-y-4">
                {transactions.filter(t => t.type === 'Referral Reward').length > 0 ? (
                  transactions.filter(t => t.type === 'Referral Reward').map(t => (
                    <div key={t.id} className="flex items-center justify-between p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-emerald-500/10 rounded-full flex items-center justify-center">
                          <UserIcon className="text-emerald-500 w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-bold">Referral Bonus</p>
                          <p className="text-xs text-slate-500">From User: {t.fromUser?.slice(0, 8)}...</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-emerald-400 font-bold">+${(t.amount || 0).toFixed(2)}</p>
                        <p className="text-xs text-slate-500">{t.createdAt?.toDate().toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-slate-500 italic">
                    No referral rewards yet. Start inviting friends!
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'support' && (
          <div className="space-y-6">
            {!isChatActive ? (
              <div className="glass-card p-8 text-center">
                <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Headphones className="w-8 h-8 text-emerald-500" />
                </div>
                <h3 className="text-2xl font-bold mb-2">Customer Support</h3>
                <p className="text-slate-400 mb-8 max-w-md mx-auto">
                  Need help with your account or investments? Our support team is available 24/7 to assist you.
                </p>
                
                <div className="max-w-lg mx-auto">
                  <button 
                    onClick={() => setIsChatActive(true)}
                    className="w-full flex items-center justify-center gap-3 p-4 bg-emerald-500 text-white rounded-xl font-bold shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition-all group"
                  >
                    <MessageCircle className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    Start Live Chat
                  </button>
                </div>
              </div>
            ) : (
              <div className="glass-card flex flex-col h-[500px] overflow-hidden">
                <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="font-bold">Live Support Agent</span>
                  </div>
                  <button 
                    onClick={() => setIsChatActive(false)}
                    className="text-slate-500 hover:text-white text-xs font-medium"
                  >
                    End Session
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
                  {chatHistory.length === 0 && (
                    <div className="text-center py-10">
                      <p className="text-slate-500 text-sm">How can we help you today?</p>
                    </div>
                  )}
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                        msg.role === 'user' 
                          ? 'bg-emerald-500 text-white rounded-tr-none' 
                          : 'bg-slate-800 text-slate-200 rounded-tl-none'
                      }`}>
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  {isAgentTyping && (
                    <div className="flex justify-start">
                      <div className="bg-slate-800 p-3 rounded-2xl rounded-tl-none flex gap-1">
                        <div className="w-1 h-1 bg-slate-500 rounded-full animate-bounce" />
                        <div className="w-1 h-1 bg-slate-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                        <div className="w-1 h-1 bg-slate-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                </div>

                <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-900/50">
                  <div className="relative">
                    <input 
                      type="text"
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      placeholder="Type your message..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl py-3 px-4 pr-12 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                    <button 
                      type="submit"
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-emerald-500 hover:text-emerald-400 transition-colors"
                    >
                      <ArrowUpRight className="w-5 h-5" />
                    </button>
                  </div>
                </form>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass-card p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <Zap className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-bold">Fast Response</p>
                  <p className="text-xs text-slate-500">Under 5 minutes</p>
                </div>
              </div>
              <div className="glass-card p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-bold">Secure Chat</p>
                  <p className="text-xs text-slate-500">End-to-end encrypted</p>
                </div>
              </div>
              <div className="glass-card p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
                  <Star className="w-5 h-5 text-emerald-500" />
                </div>
                <div>
                  <p className="text-sm font-bold">Expert Team</p>
                  <p className="text-xs text-slate-500">Certified professionals</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <Modal isOpen={isDepositOpen} onClose={() => { setIsDepositOpen(false); setIsWaitingForConfirmation(false); }} title={isWaitingForConfirmation ? "Waiting for Confirmation" : "Deposit USDT"}>
        <div className="text-center">
          {isWaitingForConfirmation ? (
            <div className="py-12">
              <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Waiting for Confirmation</h3>
              <p className="text-slate-400">Your deposit request has been submitted. Please wait while our system confirms the transaction.</p>
              <button 
                onClick={() => { setIsDepositOpen(false); setIsWaitingForConfirmation(false); }}
                className="mt-8 px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold transition-all"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="bg-white p-4 rounded-2xl inline-block mb-6">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${USDT_ADDRESS}`} 
                  alt="Deposit QR Code" 
                  className="w-40 h-40"
                  referrerPolicy="no-referrer"
                />
              </div>
              
              <div className="mb-6 text-left">
                <label className="block text-sm font-medium text-slate-400 mb-2">Deposit Amount (USD)</label>
                <div className="relative">
                  <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5" />
                  <input 
                    type="number" 
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    min={MIN_DEPOSIT}
                    max={MAX_DEPOSIT}
                    placeholder="0.00"
                    className="w-full bg-slate-950 border border-slate-800 p-4 pl-12 rounded-xl text-white placeholder:text-slate-700 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <label className="block text-sm font-medium text-slate-400 mt-4 mb-2">Transaction Hash</label>
                <input 
                  type="text" 
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="Enter your transaction hash"
                  className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl text-white placeholder:text-slate-700 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <div className="flex justify-between mt-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">
                  <span>Min: ${MIN_DEPOSIT}</span>
                  <span>Max: ${MAX_DEPOSIT}</span>
                </div>
              </div>

              <p className="text-slate-400 text-sm mb-4 text-left">Send only <span className="text-emerald-400 font-bold">USDT (TRC20)</span> to this address. Other assets will be lost.</p>
              
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex items-center justify-between gap-3 mb-6">
                <span className="text-xs font-mono text-slate-300 break-all text-left">{USDT_ADDRESS}</span>
                <button 
                  onClick={handleCopy}
                  className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-emerald-400"
                >
                  {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </button>
              </div>

              <button 
                onClick={handleDepositSubmit}
                disabled={isSubmitting}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
                I've Sent the Funds
              </button>
            </>
          )}
        </div>
      </Modal>

      <Modal isOpen={isWithdrawOpen} onClose={() => setIsWithdrawOpen(false)} title="Withdraw Funds">
        <form onSubmit={handleWithdraw} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Your USDT TRC20 Address</label>
            <input 
              required
              type="text" 
              value={withdrawAddress}
              onChange={(e) => setWithdrawAddress(e.target.value)}
              placeholder="T..."
              className="w-full bg-slate-950 border border-slate-800 p-4 rounded-xl text-white placeholder:text-slate-700 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">Withdrawal Amount (USD)</label>
            <div className="relative">
              <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5" />
              <input 
                required
                type="number" 
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                min={MIN_WITHDRAWAL}
                max={MAX_WITHDRAWAL}
                placeholder="0.00"
                className="w-full bg-slate-950 border border-slate-800 p-4 pl-12 rounded-xl text-white placeholder:text-slate-700 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            <div className="flex justify-between mt-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">
              <span>Min: ${MIN_WITHDRAWAL}</span>
              <span>Max: ${MAX_WITHDRAWAL}</span>
            </div>
          </div>

          <div className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-xl">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-400">Fee (0%)</span>
              <span className="text-white">$0.00</span>
            </div>
            <div className="flex justify-between text-base font-bold">
              <span className="text-slate-200">You will receive</span>
              <span className="text-emerald-400">${withdrawAmount || "0.00"}</span>
            </div>
          </div>

          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
            Confirm Withdrawal
          </button>
        </form>
      </Modal>
    </motion.div>
  </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [openDeposit, setOpenDeposit] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'dashboard' | 'investments' | 'transactions' | 'referrals'>('dashboard');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isInvestModalOpen, setIsInvestModalOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [investAmount, setInvestAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedPlanForDetails, setSelectedPlanForDetails] = useState<Plan | null>(null);

  useEffect(() => {
    if (!user) return;

    // Check for pending deposits every minute
    const interval = setInterval(async () => {
      const q = query(collection(db, 'deposits'), where('uid', '==', user.uid), where('status', '==', 'pending'));
      const snap = await getDocs(q);
      const now = Date.now();
      snap.docs.forEach(doc => {
        const tx = { ...doc.data(), id: doc.id } as Transaction;
        const createdAt = tx.createdAt?.toMillis() || 0;
        if (now - createdAt > 60000) { // 1 minute
          autoApproveDeposit(tx);
        }
      });
    }, 60000);

    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!user) return;

    // Update profits every hour
    const interval = setInterval(() => {
      processUserProfits(user.uid);
    }, 3600000);

    return () => clearInterval(interval);
  }, [user]);

  const autoApproveDeposit = async (tx: Transaction) => {
    try {
      const userRef = doc(db, 'users', tx.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) throw new Error("User not found");
      const userData = userSnap.data() as UserProfile;

      await setDoc(userRef, { balance: (userData.balance || 0) + tx.amount }, { merge: true });
      await setDoc(doc(db, 'deposits', tx.id), { status: 'completed' }, { merge: true });
      
      // Referral Reward (10% of first deposit)
      if (userData.referredBy) {
        const referrerRef = doc(db, 'users', userData.referredBy);
        const referrerSnap = await getDoc(referrerRef);
        if (referrerSnap.exists()) {
          const reward = tx.amount * 0.1;
          const referrerData = referrerSnap.data() as UserProfile;
          
          // Check if this is the user's first deposit
          const depositsSnap = await getDocs(query(collection(db, 'deposits'), where('uid', '==', tx.uid), where('status', '==', 'completed')));
          const isFirstDeposit = depositsSnap.empty;

          const batch = writeBatch(db);
          
          let newActiveCount = referrerData.activeReferralCount || 0;
          let totalBonus = 0;
          const claimedTiers = referrerData.claimedTiers || [];
          const newClaimedTiers = [...claimedTiers];

          if (isFirstDeposit) {
            newActiveCount += 1;
            
            // Check for tiered rewards
            REFERRAL_TIERS.forEach((tier, index) => {
              if (newActiveCount >= tier.count && !claimedTiers.includes(index)) {
                totalBonus += tier.reward;
                newClaimedTiers.push(index);
                
                // Create a transaction for the tier bonus
                batch.set(doc(collection(db, 'deposits')), {
                  uid: userData.referredBy,
                  amount: tier.reward,
                  type: 'Referral Reward',
                  status: 'completed',
                  createdAt: serverTimestamp(),
                  fromUser: `Tier: ${tier.name}`
                });
              }
            });
          }

          batch.update(referrerRef, {
            balance: (referrerData.balance || 0) + reward + totalBonus,
            totalReferralEarnings: (referrerData.totalReferralEarnings || 0) + reward + totalBonus,
            activeReferralCount: newActiveCount,
            claimedTiers: newClaimedTiers
          });
          
          batch.set(doc(collection(db, 'deposits')), {
            uid: userData.referredBy,
            amount: reward,
            type: 'Referral Reward',
            status: 'completed',
            createdAt: serverTimestamp(),
            fromUser: tx.uid
          });
          
          await batch.commit();
        }
      }
    } catch (error) {
      console.error("Error auto-approving deposit:", error);
    }
  };

  const processUserProfits = async (uid: string) => {
    try {
      const investmentsSnap = await getDocs(query(collection(db, 'investments'), where('uid', '==', uid), where('status', '==', 'active')));
      if (investmentsSnap.empty) return;

      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) return;
      
      const userData = userSnap.data() as UserProfile;
      let totalNewProfit = 0;
      const batch = writeBatch(db);
      let hasUpdates = false;
      const now = Date.now();

      for (const invDoc of investmentsSnap.docs) {
        const inv = invDoc.data();
        const lastClaim = inv.lastProfitClaimedAt?.toMillis() || inv.startDate?.toMillis() || now;
        const msElapsed = now - lastClaim;
        const daysElapsed = Math.floor(msElapsed / (24 * 60 * 60 * 1000));

        if (daysElapsed >= 1) {
          const dailyProfitAmt = (inv.amount * inv.dailyProfit) / 100;
          const profitToAdd = dailyProfitAmt * daysElapsed;
          totalNewProfit += profitToAdd;
          
          const newClaimTime = lastClaim + (daysElapsed * 24 * 60 * 60 * 1000);
          const endDate = inv.endDate?.toMillis() || (inv.startDate?.toMillis() + 30 * 24 * 60 * 60 * 1000);
          const isCompleted = newClaimTime >= endDate;

          batch.update(doc(db, 'investments', invDoc.id), {
            lastProfitClaimedAt: new Date(newClaimTime),
            ...(isCompleted ? { status: 'completed' } : {})
          });
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        batch.update(userRef, {
          balance: (userData.balance || 0) + totalNewProfit,
          totalProfit: (userData.totalProfit || 0) + totalNewProfit
        });
        await batch.commit();
        console.log(`Processed $${totalNewProfit} profit for user ${uid}`);
      }
    } catch (error) {
      console.error('Error processing user profits:', error);
      // Don't throw handleFirestoreError here as it runs in background and would spam the UI
    }
  };

  useEffect(() => {
    if (!user) return;
    processUserProfits(user.uid);
    const interval = setInterval(() => {
      processUserProfits(user.uid);
    }, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [user]);

  // Auth Listener
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref) {
      localStorage.setItem('referralCode', ref);
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        try {
          // Ensure user profile exists in Firestore
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            const referralCode = localStorage.getItem('referralCode');
            const newProfile: UserProfile = {
              uid: currentUser.uid,
              email: currentUser.email || "",
              username: currentUser.displayName || currentUser.email?.split('@')[0] || "User",
              balance: 0,
              totalInvested: 0,
              totalProfit: 0,
              createdAt: serverTimestamp(),
              role: currentUser.email === "haseeb.ali.punjab1515@gmail.com" ? "admin" : "user",
              ...(referralCode ? { referredBy: referralCode } : {}),
              referralCount: 0,
              activeReferralCount: 0,
              totalReferralEarnings: 0,
              claimedTiers: []
            };
            await setDoc(userRef, newProfile);

            // If referred, increment referrer's count
            if (referralCode) {
              const referrerRef = doc(db, 'users', referralCode);
              const referrerSnap = await getDoc(referrerRef);
              if (referrerSnap.exists()) {
                await updateDoc(referrerRef, {
                  referralCount: (referrerSnap.data().referralCount || 0) + 1
                });
              }
              localStorage.removeItem('referralCode');
            }
          } else {
            // Update role if it's the admin email but role is not set
            const data = userSnap.data();
            if (currentUser.email === "haseeb.ali.punjab1515@gmail.com" && data.role !== "admin") {
              await setDoc(userRef, { role: "admin" }, { merge: true });
            }
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `users/${currentUser.uid}`);
        }
      } else {
        setProfile(null);
        setTransactions([]);
        setIsDashboardOpen(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Profile and Transactions Listener
  useEffect(() => {
    if (!user) return;

    const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as UserProfile);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));

    const qDeposits = query(collection(db, 'deposits'), where('uid', '==', user.uid));
    const unsubDeposits = onSnapshot(qDeposits, (snap) => {
      const deps = snap.docs.map(d => ({ ...d.data(), id: d.id, type: d.data().type || 'Deposit' } as Transaction));
      setTransactions(prev => {
        const others = prev.filter(t => t.type !== 'Deposit' && t.type !== 'Referral Reward');
        return [...others, ...deps].sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'deposits'));

    const qWithdrawals = query(collection(db, 'withdrawals'), where('uid', '==', user.uid));
    const unsubWithdrawals = onSnapshot(qWithdrawals, (snap) => {
      const withs = snap.docs.map(d => ({ ...d.data(), id: d.id, type: 'Withdrawal' } as Transaction));
      setTransactions(prev => {
        const others = prev.filter(t => t.type !== 'Withdrawal');
        return [...others, ...withs].sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'withdrawals'));

    const qInvestments = query(collection(db, 'investments'), where('uid', '==', user.uid));
    const unsubInvestments = onSnapshot(qInvestments, (snap) => {
      const invs = snap.docs.map(d => ({ ...d.data(), id: d.id, type: 'Investment' } as any as Transaction));
      setTransactions(prev => {
        const others = prev.filter(t => t.type !== 'Investment');
        return [...others, ...invs].sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'investments'));

    return () => {
      unsubProfile();
      unsubDeposits();
      unsubWithdrawals();
      unsubInvestments();
    };
  }, [user]);

  const handleInvest = (plan: Plan) => {
    if (!user) {
      loginWithGoogle();
      return;
    }
    setSelectedPlan(plan);
    setIsInvestModalOpen(true);
  };

  const handleInvestSubmit = async () => {
    if (!user || !selectedPlan || !profile) return;
    const amt = parseFloat(investAmount);
    
    if (amt < selectedPlan.minDeposit || amt > selectedPlan.maxDeposit) {
      alert(`Investment must be between $${selectedPlan.minDeposit} and $${selectedPlan.maxDeposit}`);
      return;
    }
    
    if (amt > profile.balance) {
      alert("Insufficient balance. Please deposit funds first.");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Create investment
      await addDoc(collection(db, 'investments'), {
        uid: user.uid,
        planId: selectedPlan.id,
        amount: amt,
        dailyProfit: selectedPlan.dailyProfit,
        startDate: serverTimestamp(),
        endDate: new Date(Date.now() + selectedPlan.durationDays * 24 * 60 * 60 * 1000),
        lastProfitClaimedAt: serverTimestamp(),
        status: 'active'
      });

      // 2. Update user balance
      await setDoc(doc(db, 'users', user.uid), {
        balance: (profile.balance || 0) - amt,
        totalInvested: (profile.totalInvested || 0) + amt
      }, { merge: true });

      alert(`Investment of $${amt} in ${selectedPlan.name} successful!`);
      setIsInvestModalOpen(false);
      setInvestAmount("");
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'investments');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <WithdrawalNotification />
      <div className="min-h-screen">
        <Navbar 
          user={user} 
          onOpenAuth={() => setIsAuthOpen(true)}
          onOpenDashboard={(tab, deposit) => {
            if (tab) setDashboardTab(tab);
            if (deposit) setOpenDeposit(true);
            setIsDashboardOpen(true);
          }} 
          onLogout={logout} 
        />
        
        <main>
          <Hero 
            user={user}
            onGetStarted={() => user ? setIsDashboardOpen(true) : setIsAuthOpen(true)} 
            onDeposit={() => {
              if (user) {
                setOpenDeposit(true);
                setIsDashboardOpen(true);
              } else {
                setIsAuthOpen(true);
              }
            }}
          />
          
          {/* Plans */}
          <section id="plans" className="py-24">
            <div className="max-w-7xl mx-auto px-6">
              <div className="text-center mb-16">
                <h2 className="text-3xl md:text-4xl font-bold mb-4">Investment Plans</h2>
                <p className="text-slate-400 max-w-xl mx-auto">Choose a plan that fits your financial goals. Our diversified strategies ensure consistent returns.</p>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-8">
                {PLANS.map(plan => (
                  <div key={plan.id}>
                    <PlanCard 
                      plan={plan} 
                      onInvest={handleInvest} 
                      onClick={() => setSelectedPlanForDetails(plan)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Features */}
          <section id="security" className="py-20 bg-slate-900/30">
            <div className="max-w-7xl mx-auto px-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                <div className="text-center">
                  <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <ShieldCheck className="text-emerald-500 w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Military-Grade Security</h3>
                  <p className="text-slate-400">Your assets are protected by multi-sig cold storage and advanced encryption protocols.</p>
                </div>
                <div className="text-center">
                  <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Zap className="text-blue-500 w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Instant Withdrawals</h3>
                  <p className="text-slate-400">Our automated system processes withdrawal requests instantly, 24/7, without delays.</p>
                </div>
                <div className="text-center">
                  <div className="w-16 h-16 bg-purple-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <TrendingUp className="text-purple-500 w-8 h-8" />
                  </div>
                  <h3 className="text-xl font-bold mb-3">Transparent Profits</h3>
                  <p className="text-slate-400">Real-time tracking of your earnings with detailed reports and historical data analytics.</p>
                </div>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="py-20">
            <div className="max-w-5xl mx-auto px-6">
              <div className="glass-card p-12 text-center relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 to-blue-500/10 -z-10" />
                <h2 className="text-3xl md:text-4xl font-bold mb-6">Ready to Start Your Journey?</h2>
                <p className="text-slate-400 mb-10 max-w-2xl mx-auto">Join over 50,000+ investors worldwide who trust CryptoInvest Pro for their digital asset growth.</p>
                <button 
                  onClick={() => user ? setIsDashboardOpen(true) : loginWithGoogle()}
                  className="bg-white text-slate-950 px-10 py-4 rounded-2xl font-bold hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 mx-auto"
                >
                  {user ? <LayoutDashboard className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
                  {user ? "Go to Dashboard" : "Login with Google"}
                </button>
              </div>
            </div>
          </section>

          <FAQSection />
          <TestimonialsSection />
        </main>

        <PlanDetailsModal 
          plan={selectedPlanForDetails!} 
          isOpen={!!selectedPlanForDetails} 
          onClose={() => setSelectedPlanForDetails(null)} 
          onInvest={handleInvest}
        />

        <footer className="py-12 border-t border-slate-900">
          <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-2">
              <TrendingUp className="text-emerald-500 w-6 h-6" />
              <span className="text-lg font-bold">InvestPro</span>
            </div>
            <p className="text-slate-500 text-sm">© 2026 CryptoInvest Pro. All rights reserved. High-risk investment disclaimer applies.</p>
            <div className="flex gap-6 text-slate-400 text-sm">
              <a href="#" className="hover:text-white transition-colors">Terms</a>
              <a href="#" className="hover:text-white transition-colors">Privacy</a>
              <a href="#" className="hover:text-white transition-colors">Support</a>
            </div>
          </div>
        </footer>

        {user && (
          <Dashboard 
            isOpen={isDashboardOpen} 
            onClose={() => {
              setIsDashboardOpen(false);
              setOpenDeposit(false);
              setDashboardTab('dashboard');
            }} 
            user={user}
            profile={profile}
            transactions={transactions}
            initialDepositOpen={openDeposit}
            initialTab={dashboardTab}
          />
        )}

        <AuthModal 
          isOpen={isAuthOpen}
          onClose={() => setIsAuthOpen(false)}
          onAuthSuccess={() => setIsDashboardOpen(true)}
        />

        {/* Investment Modal */}
        <Modal 
          isOpen={isInvestModalOpen} 
          onClose={() => setIsInvestModalOpen(false)} 
          title={`Invest in ${selectedPlan?.name}`}
        >
          <div className="space-y-6">
            <div className="p-4 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <div className="flex justify-between mb-2">
                <span className="text-slate-400">Daily Profit</span>
                <span className="text-emerald-400 font-bold">{selectedPlan?.dailyProfit}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Duration</span>
                <span className="text-white font-bold">{selectedPlan?.durationDays} Days</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2">Investment Amount (USD)</label>
              <div className="relative">
                <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 w-5 h-5" />
                <input 
                  type="number" 
                  value={investAmount}
                  onChange={(e) => setInvestAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-950 border border-slate-800 p-4 pl-12 rounded-xl text-white placeholder:text-slate-700 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>
              <div className="flex justify-between mt-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">
                <span>Min: ${selectedPlan?.minDeposit}</span>
                <span>Max: ${(selectedPlan?.maxDeposit || 0).toLocaleString()}</span>
              </div>
            </div>

            <div className="flex justify-between items-center p-4 bg-slate-900 rounded-xl">
              <span className="text-slate-400">Available Balance</span>
              <span className="text-white font-bold">${(profile?.balance || 0).toFixed(2)}</span>
            </div>

            <button 
              onClick={handleInvestSubmit}
              disabled={isSubmitting}
              className="w-full py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-5 h-5 animate-spin" />}
              Confirm Investment
            </button>
          </div>
        </Modal>

        {/* Floating Customer Service Button */}
        <motion.div 
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1 }}
          className="fixed bottom-6 right-6 z-[60]"
        >
          <button 
            onClick={() => {
              if (user) {
                setDashboardTab('support');
                setIsDashboardOpen(true);
              } else {
                setIsAuthOpen(true);
              }
            }}
            className="group relative flex items-center justify-center w-14 h-14 bg-emerald-500 hover:bg-emerald-400 text-white rounded-full shadow-2xl shadow-emerald-500/40 transition-all hover:scale-110 active:scale-95"
          >
            <Headphones className="w-6 h-6" />
            <span className="absolute right-full mr-4 px-3 py-1.5 bg-slate-900 text-white text-xs font-bold rounded-lg border border-slate-800 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none shadow-xl">
              Customer Support
            </span>
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 border-2 border-slate-950 rounded-full animate-pulse" />
          </button>
        </motion.div>
      </div>
    </ErrorBoundary>
  );
}
