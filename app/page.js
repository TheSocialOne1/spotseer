"use client";

import dynamic from "next/dynamic";

// Client-only: the app is a live map driven by GPS and device storage, so a
// server render has nothing useful to show.
const App = dynamic(() => import("./components/App"), {
  ssr: false,
  loading: () => <div className="h-dvh w-full bg-[#0b0f14]" />,
});

export default function Home() {
  return <App />;
}
