import Image from "next/image";

export default function HelloPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="text-center">
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.25em] text-cyan-400">
          Hello
        </p>
        <h1 className="text-5xl font-bold sm:text-7xl">안녕하세요!</h1>
        <p className="mt-5 text-lg text-slate-300">
          /hello 페이지에 오신 것을 환영합니다...
        </p>
      </div>
    </main>
  );
}
