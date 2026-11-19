/** Serialize native requests so a late enable cannot outlive pause/navigation. */
export function createScreenAwakeController(apply: (options: {keepScreenOn:boolean;success:()=>void;fail:(error:any)=>void;complete:()=>void}) => void) {
  let desired = false, applied: boolean | null = null, pending = false, retries = 0;
  function flush() {
    if (pending || applied === desired) return;
    const target = desired;
    pending = true;
    let failed = false;
    try {
      apply({keepScreenOn:target,
        success:()=>{applied=target;retries=0},
        fail:()=>{failed=true;applied=null},
        complete:()=>{pending=false;if(target!==desired || (failed && retries++<1))flush()}
      });
    } catch { pending=false;applied=null; }
  }
  return {set(enabled:boolean, force=false){desired=enabled;if(force)applied=null;flush()}};
}
