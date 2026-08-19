'use client';
import { useRouter } from 'next/navigation';

export default function AssetsPage() {
  const router = useRouter();
  const assets = [
    { name: "Logo", path: "/agents/logo.jpg", type: "Image" },
    { name: "Beepbop", path: "/agents/beepbop.jpg", type: "Image" },
    { name: "Maya", path: "/agents/maya.jpg", type: "Image" },
    { name: "Leo", path: "/agents/leo.jpg", type: "Image" },
    { name: "Lex", path: "/agents/lex.jpg", type: "Image" },
    { name: "Zackary", path: "/agents/zack.jpg", type: "Image" },
    { name: "Evie", path: "/agents/evie.jpg", type: "Image" },
    { name: "Sally", path: "/agents/sally.jpg", type: "Image" },
    { name: "Kevin", path: "/agents/kevin.jpg", type: "Image" },
  ];

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] p-8">
      <div className="mx-auto max-w-6xl">
        <button 
          onClick={() => router.back()}
          className="mb-8 flex items-center text-white/60 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <h1 className="text-3xl font-bold text-white mb-8">Application Assets</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {assets.map((asset) => (
            <div key={asset.name} className="group rounded-2xl border border-white/10 bg-white/5 p-4 transition-all hover:bg-white/10 hover:border-white/20">
              <div className="aspect-square relative mb-4 rounded-xl overflow-hidden bg-black/50">
                <img src={asset.path} alt={asset.name} className="object-cover w-full h-full opacity-80 group-hover:opacity-100 transition-opacity" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
              <h2 className="font-semibold text-white">{asset.name}</h2>
              <p className="text-xs text-white/40 uppercase tracking-wider">{asset.type}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
