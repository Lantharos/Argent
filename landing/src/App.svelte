<script lang="ts">
    import { onMount } from "svelte";

    const repoUrl = "https://github.com/Lantharos/Argent";
</script>

<svelte:head>
    <title>Argent</title>
    <meta
        name="description"
        content="Argent is a free, open source desktop workspace that brings AI chat, code editing, terminal sessions, browser tabs, and Git tools into one composable window."
    />
</svelte:head>

<div class="relative min-h-screen overflow-hidden bg-[#C7C3C0] scroll-smooth">
    <img src="/bg.jpg" alt="" class="absolute inset-0 w-full h-screen" />

    <div class="z-20 relative">
        <h1
            class="font-poppins text-[#534E45] text-[96px] font-semibold text-center my-8"
        >
            Meet Argent
        </h1>

        <img
            src="/argent-preview.png"
            alt="Argent Preview"
            class="w-full rounded-t-2xl"
        />
    </div>

    <div class="z-30 relative p-[150px]">
        <div class="flex flex-col gap-[20px]">
            <h1 class="text-black font-poppins text-[76px] font-semibold">
                It is not trying to turn development into a single chat box.
            </h1>

            <p class="text-black font-poppins text-[32px]">
                Argent is built around the reality that coding work jumps
                between thinking, editing, running commands, checking output,
                reading docs, and committing changes. The point is not to hide
                those surfaces. The point is to keep them together.
            </p>
        </div>

        <div class="flex flex-row justify-between items-center mt-30">
            <div class="flex flex-row gap-[20px] items-center">
                <svg
                    width="39"
                    height="55"
                    viewBox="0 0 39 55"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        d="M19.4167 11.4167V22.0833M19.4167 0.75C29.726 0.75 38.0833 9.10735 38.0833 19.4167V35.4167C38.0833 45.726 29.726 54.0833 19.4167 54.0833C9.10735 54.0833 0.75 45.726 0.75 35.4167V19.4167C0.75 9.10735 9.10735 0.75 19.4167 0.75Z"
                        stroke="black"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
                <p class="font-poppins text-[32px] text-black font-light">
                    scroll for more
                </p>
            </div>

            <div class="flex flex-row items-center gap-5">
                <a
                    href="https://github.com/lantharos/argent"
                    class="py-[20px] px-[30px] hover:bg-[#B5B2AD] flex flex-row gap-[20px] items-center text-[24px] font-poppins text-[#2F2F2F] transition-colors duration-300 rounded-[24px] cursor-pointer"
                >
                    <svg
                        width="42"
                        height="42"
                        viewBox="0 0 42 42"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            d="M26.25 38.5V31.5C26.4935 29.3078 25.8649 27.1077 24.5 25.375C29.75 25.375 35 21.875 35 15.75C35.14 13.5625 34.5275 11.41 33.25 9.625C33.74 7.6125 33.74 5.5125 33.25 3.5C33.25 3.5 31.5 3.5 28 6.125C23.38 5.25 18.62 5.25 14 6.125C10.5 3.5 8.75 3.5 8.75 3.5C8.225 5.5125 8.225 7.6125 8.75 9.625C7.47578 11.4028 6.85733 13.5674 7 15.75C7 21.875 12.25 25.375 17.5 25.375C16.8175 26.2325 16.31 27.2125 16.0125 28.2625C15.715 29.3125 15.6275 30.415 15.75 31.5M15.75 31.5V38.5M15.75 31.5C7.8575 35 7 28 3.5 28"
                            stroke="#2F2F2F"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    </svg>
                    GitHub
                </a>

                <button
                    class="bg-[#4E4639] hover:bg-[#625B4F] flex flex-row gap-[20px] text-[24px] items-center py-[20px] px-[30px] font-poppins text-[#D3D3D3] transition-colors duration-300 rounded-[24px] cursor-pointer"
                >
                    <svg
                        width="36"
                        height="36"
                        viewBox="0 0 42 43"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            d="M20.2227 42.7773H0V22.5557H20.2227V42.7773ZM42 42.7773H21.7773V22.5557H42V42.7773ZM20.2227 20.2227H0V0H20.2227V20.2227ZM42 20.2227H21.7773V0H42V20.2227Z"
                            fill="#D9D9D9"
                        />
                    </svg>

                    Download for Windows
                </button>
            </div>
        </div>
    </div>
</div>
