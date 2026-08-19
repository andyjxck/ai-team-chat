export default function AssetsPage() {
  const assets = [
    { name: "Logo", path: "/agents/logo.jpg", type: "Image" },
    { name: "Beepbop Avatar", path: "/agents/beepbop.png", type: "Image" },
    { name: "Maya Avatar", path: "/agents/maya.png", type: "Image" },
    { name: "Leo Avatar", path: "/agents/leo.png", type: "Image" },
    { name: "Lex Avatar", path: "/agents/lex.png", type: "Image" },
    { name: "Zackary Avatar", path: "/agents/zackary.png", type: "Image" },
    { name: "Evie Avatar", path: "/agents/evie.png", type: "Image" },
    { name: "Sally Avatar", path: "/agents/sally.png", type: "Image" },
  ];

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] p-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="text-3xl font-bold text-white mb-8">Application Assets</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {assets.map((asset) => (
            <div key={asset.name} className="group rounded-2xl border border-white/10 bg-white/5 p-4 transition-all hover:bg-white/10 hover:border-white/20">
              <div className="aspect-square relative mb-4 rounded-xl overflow-hidden bg-black/50">
                <img src={asset.path} alt={asset.name} className="object-cover w-full h-full opacity-80 group-hover:opacity-100 transition-opacity" />
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
