"use client";

type RobotBackdropProps = {
  sceneUrl?: string;
};

export function RobotBackdrop({ sceneUrl }: RobotBackdropProps) {
  if (sceneUrl) {
    return (
      <iframe
        title="Spline robot assistant"
        src={sceneUrl}
        className="pointer-events-none absolute -right-10 -top-8 h-[360px] w-[360px] border-0 opacity-20"
        loading="lazy"
      />
    );
  }

  return (
    <div className="pointer-events-none absolute -right-8 top-4 h-[310px] w-[310px] opacity-[0.13]" aria-hidden="true">
      <div className="absolute left-[88px] top-[18px] h-[132px] w-[146px] rounded-[42px] border border-blue-500/60 bg-blue-200/70 shadow-[inset_0_0_32px_rgba(37,99,235,0.22)]">
        <div className="absolute left-[30px] top-[45px] h-5 w-5 rounded-full bg-blue-900" />
        <div className="absolute right-[30px] top-[45px] h-5 w-5 rounded-full bg-blue-900" />
        <div className="absolute left-[46px] top-[82px] h-2 w-[54px] rounded-full bg-blue-700" />
      </div>
      <div className="absolute left-[77px] top-[156px] h-[106px] w-[168px] rounded-[34px] border border-blue-500/60 bg-white/80 shadow-[inset_0_0_36px_rgba(37,99,235,0.2)]" />
      <div className="absolute left-[42px] top-[176px] h-[78px] w-[40px] rounded-full border border-blue-500/50 bg-blue-100" />
      <div className="absolute right-[38px] top-[176px] h-[78px] w-[40px] rounded-full border border-blue-500/50 bg-blue-100" />
      <div className="absolute left-[116px] top-[262px] h-[30px] w-[32px] rounded-full bg-blue-300" />
      <div className="absolute right-[112px] top-[262px] h-[30px] w-[32px] rounded-full bg-blue-300" />
      <div className="absolute left-[156px] top-0 h-7 w-1.5 rounded-full bg-blue-500" />
      <div className="absolute left-[147px] top-[-8px] h-5 w-5 rounded-full bg-blue-600" />
    </div>
  );
}
