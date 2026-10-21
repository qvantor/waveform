//! The runtime of a core on wasm32: the cores are built without std there (its panic machinery formats messages
//! nobody reads and doubles the size of a module). A panic (an index out of its bounds, an allocation that
//! failed) traps: the JS wrapper of the core puts the stack pointer back and the processor fails alone. The
//! allocator is dlmalloc, the one std uses on wasm32. Elsewhere (cargo test) std has both
#![no_std]

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOCATOR: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;
