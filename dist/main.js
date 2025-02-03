// Supabase configuration
const supabaseUrl = 'https://hqdwfwatvlsqkhuvifvo.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxZHdmd2F0dmxzcWtodXZpZnZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzg0MTUyMzAsImV4cCI6MjA1Mzk5MTIzMH0.jD6qQWUXat_SHZm5Ncq31vwZYj-ApExeIsab9hBhoo0'
const { createClient } = supabase
const supabaseInstance = createClient(supabaseUrl, supabaseKey)

// Variables
var stream = null,
    audio = null,
    mixedStream = null,
    chunks = [],
    recorder = null,
    startButton = null,
    stopButton = null,
    downloadButton = null,
    recordedVideo = null;

// Premium state and dashboard
let isPremiumUser = false;
let recordingTimer;
let isDashboardOpen = false;
let currentBlob = null;
let editedBlob = null;
let textOverlays = [];

// Initialize UI elements
const loader = document.getElementById('loader');
const premiumBadge = document.getElementById('premium-badge');
const authButton = document.getElementById('auth-button');

// Initialize Stripe
const stripe = Stripe('YOUR_STRIPE_PUBLIC_KEY');

// Dashboard functions
const toggleDashboard = () => {
    document.getElementById('dashboard').classList.toggle('hidden');
    document.getElementById('recording-section').classList.add('hidden');
    // Close mobile menu if open
    if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.remove('active');
    }
};

const loadDashboard = async () => {
    const { data: { user } } = await supabaseInstance.auth.getUser()
    if (!user) return
    
    showLoader()
    try {
        // Load subscription status
        const { data: profile, error: profileError } = await supabaseInstance
            .from('profiles')
            .select('is_premium')
            .eq('id', user.id)
            .single()
            
        if (profileError) throw profileError
        
        document.getElementById('plan-status').textContent = 
            profile?.is_premium ? "Premium" : "Free"

        // Load recordings
        const { data: recordings, error: recordingsError } = await supabaseInstance
            .from('recordings')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            
        if (recordingsError) throw recordingsError
            
        const historyList = document.getElementById('history-list')
        historyList.innerHTML = ''
        
        recordings.forEach(recording => {
            historyList.innerHTML += `
                <div class="bg-gray-700 p-4 rounded">
                    <p>Date: ${new Date(recording.created_at).toLocaleString()}</p>
                    <p>Duration: ${recording.duration} seconds</p>
                    <a href="${recording.url}" target="_blank" 
                       class="text-blue-400 hover:text-blue-300">View Recording</a>
                </div>
            `
        })
    } catch (err) {
        alert('Dashboard error: ' + err.message)
    } finally {
        hideLoader()
    }
}

// Update auth state listener
const checkUser = async () => {
    showLoader();
    try {
        const { data: { user } } = await supabaseInstance.auth.getUser()
        if (user) {
            authButton.textContent = 'Logout'
            await checkPremiumStatus(user.id)
            await loadDashboard()
        } else {
            authButton.textContent = 'Login'
            premiumBadge.classList.add('hidden')
        }
    } catch (err) {
        console.error('Error checking user:', err)
    } finally {
        hideLoader();
    }
}

// Auth handler
authButton.addEventListener('click', () => {
    const authModal = document.getElementById('auth-modal')
    authModal.classList.toggle('hidden')
})

// Add this function to check device compatibility
const checkDeviceCompatibility = () => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const recordButton = document.querySelector('.start-recording');
    
    if (isMobile) {
        recordButton?.setAttribute('disabled', 'true');
        recordButton?.classList.add('opacity-50', 'cursor-not-allowed');
        
        // Add warning message
        const warningDiv = document.createElement('div');
        warningDiv.className = 'bg-red-500 text-white p-4 rounded-lg mb-4';
        warningDiv.innerHTML = `
            <p class="font-bold">Device Not Supported</p>
            <p>Screen recording is currently not supported on mobile browsers. Please use a desktop browser for this feature.</p>
        `;
        
        document.querySelector('#recording-section')?.insertBefore(
            warningDiv,
            document.querySelector('.video-feedback')
        );
    }
};

// Update setupStream function to handle screen dimensions
const setupStream = async () => {
    showLoader();
    try {
        // Check if mobile device
        if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
            throw new Error('Screen recording is not supported on mobile browsers. Please use a desktop browser.');
        }

        if (!navigator.mediaDevices?.getDisplayMedia) {
            throw new Error('Screen recording not supported in this browser');
        }

        // Request full screen dimensions
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: 30,
                width: { ideal: screen.width },
                height: { ideal: screen.height }
            }
        });

        audio = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });

        setupVideoFeedback();
    } catch (err) {
        alert(`Error: ${err.message}`);
    } finally {
        hideLoader();
    }
};

// Update setupVideoFeedback to maintain aspect ratio
const setupVideoFeedback = () => {
    if (stream) {
        const video = document.querySelector('.video-feedback');
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();
        
        // Set video element dimensions to match source
        video.style.width = '100%';
        video.style.maxWidth = '100%';
        video.style.height = 'auto';
        
        // Set proper aspect ratio
        const aspectRatio = settings.width / settings.height;
        video.style.aspectRatio = `${aspectRatio}`;
        
        video.srcObject = stream;
        video.play();
    } else {
        console.warn("no stream variable");
    }
}

// Payment handlers
window.paystackHandler = async (planId) => {
    showLoader();
    try {
        const { data: { user } } = await supabaseInstance.auth.getUser()
        if (!user) {
            alert('Please login first!')
            return
        }
        
        const handler = PaystackPop.setup({
            key: 'YOUR_PAYSTACK_PUBLIC_KEY',
            email: user.email,
            amount: 10000,
            currency: 'NGN',
            callback: async (response) => {
                showLoader();
                try {
                    const { error } = await supabaseInstance
                        .from('profiles')
                        .update({ is_premium: true })
                        .eq('id', user.id)
                    
                    if (error) throw error
                    window.location.reload()
                } catch (err) {
                    alert('Payment verification failed: ' + err.message)
                } finally {
                    hideLoader();
                }
            }
        })
        handler.openIframe()
    } catch (err) {
        alert('Payment setup failed: ' + err.message)
    } finally {
        hideLoader();
    }
}

window.handleSubscribe = async (planId) => {
    const { data: { user } } = await supabaseInstance.auth.getUser()
    if (!user) return alert('Please sign in first!');

    const response = await fetch('/.netlify/functions/create-stripe-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            uid: user.id,
            planId: planId
        })
    });

    const session = await response.json();
    await stripe.redirectToCheckout({ sessionId: session.id });
};

// Update the premium check to include subscription handling
const checkPremiumStatus = async (userId) => {
    try {
        const { data, error } = await supabaseInstance
            .from('profiles')
            .select('is_premium')
            .eq('id', userId)
            .single()
            
        if (error) throw error
        
        isPremiumUser = data?.is_premium || false
        premiumBadge.classList.toggle('hidden', !isPremiumUser)
        
        if (!isPremiumUser) {
            initializeAds()
            startRecordingTimer()
        }
    } catch (err) {
        console.error('Error checking premium status:', err)
    }
}

// Watermark implementation
const addWatermark = (stream) => {
    if (isPremiumUser) return stream;
    
    const canvas = new OffscreenCanvas(640, 480);
    const ctx = canvas.getContext('2d');
    
    const processor = new MediaStreamTrackProcessor({
        track: stream.getVideoTracks()[0]
    });
    
    const generator = new MediaStreamTrackGenerator({ kind: 'video' });
    
    processor.readable.pipeTo(new WritableStream({
        async write(frame) {
            try {
                ctx.drawImage(frame, 0, 0);
                ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
                ctx.font = '20px Arial';
                ctx.fillText('FlickCast - Free Version', 10, 30);
                
                const newFrame = new VideoFrame(canvas, {
                    timestamp: frame.timestamp,
                    duration: frame.duration
                });
                
                await generator.writable.getWriter().write(newFrame);
                frame.close();
                newFrame.close();
            } catch (err) {
                console.error('Frame processing error:', err);
                frame.close();
            }
        },
        close() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    }));
    
    return new MediaStream([generator, ...stream.getAudioTracks()]);
};

// Update startRecording function
const startRecording = async () => {
    try {
        checkUser();
        // Setup stream first
        await setupStream();
        if (!stream) return;

        // Get video track settings for dimensions
        const videoTrack = stream.getVideoTracks()[0];
        const settings = videoTrack.getSettings();

        // Create mixed stream with proper dimensions
        mixedStream = new MediaStream([...stream.getTracks(), ...audio.getTracks()]);
        
        recorder = new MediaRecorder(mixedStream, {
            mimeType: 'video/webm;codecs=vp8,opus',
            videoBitsPerSecond: 2500000, // 2.5 Mbps for better quality
        });

        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = async () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            chunks = [];
            
            // Show recorded video container
            const videoContainer = document.querySelector('.recorded-video-container');
            videoContainer.classList.remove('hidden');
            
            const video = document.querySelector('.recorded-video');
            video.src = URL.createObjectURL(blob);
            video.style.width = '100%';
            video.style.maxWidth = '100%';
            video.style.height = 'auto';
            video.style.aspectRatio = `${settings.width / settings.height}`;
            
            currentBlob = blob;

            // Show download and edit options
            const editTools = document.querySelector('.edit-tools');
            if (editTools) editTools.classList.remove('hidden');

            // Add download button if it doesn't exist
            if (!document.querySelector('.download-button')) {
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'download-button btn-primary mr-2';
                downloadBtn.textContent = 'Download Recording';
                downloadBtn.onclick = () => exportVideo('webm');
                videoContainer.appendChild(downloadBtn);
            }

            // Add save to cloud button for logged in users
            const { data: { user } } = await supabaseInstance.auth.getUser();
            if (user && !document.querySelector('.save-cloud-button')) {
                const saveCloudBtn = document.createElement('button');
                saveCloudBtn.className = 'save-cloud-button btn-primary';
                saveCloudBtn.textContent = 'Save to Cloud';
                saveCloudBtn.onclick = saveToCloud;
                videoContainer.appendChild(saveCloudBtn);
            }
            
            // Clean up
            stream.getTracks().forEach(track => track.stop());
            audio.getTracks().forEach(track => track.stop());

            // Scroll to recorded video
            videoContainer.scrollIntoView({ behavior: 'smooth' });
        };

        recorder.start();
        startButton.classList.add('hidden');
        stopButton.classList.remove('hidden');

        // Start timer for non-premium users
        if (!isPremiumUser) {
            startRecordingTimer();
        }
    } catch (err) {
        console.error('Error starting recording:', err);
        alert('Failed to start recording: ' + err.message);
    }
};

// Recording time limit
const startRecordingTimer = () => {
    if (isPremiumUser) return;
    
    let seconds = 300;
    recordingTimer = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
            stopRecording();
            alert('Free recording limit reached (5 minutes)');
        }
    }, 1000);
};

// Update stopRecording function
const stopRecording = () => {
    try {
        if (recordingTimer) clearInterval(recordingTimer);
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
            startButton.classList.remove('hidden');
            stopButton.classList.add('hidden');
        }
    } catch (err) {
        console.error('Error stopping recording:', err);
        alert('Failed to stop recording: ' + err.message);
    }
};

// Ad initialization
const initializeAds = () => {
    const adsContainer = document.getElementById('ads-container');
    adsContainer.innerHTML = `
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=YOUR_AD_CLIENT"
        crossorigin="anonymous"></script>
        <ins class="adsbygoogle"
            style="display:block"
            data-ad-client="YOUR_AD_CLIENT"
            data-ad-slot="YOUR_AD_SLOT"
            data-ad-format="auto"
            data-full-width-responsive="true"></ins>
        <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
    `;
};

// Loader controls
const showLoader = () => {
    document.getElementById('global-loader').classList.remove('hidden');
}

const hideLoader = () => {
    document.getElementById('global-loader').classList.add('hidden');
}

// Update window load event listener
window.addEventListener('load', () => {
    startButton = document.querySelector('.start-recording');
    stopButton = document.querySelector('.stop-recording');
    downloadButton = document.querySelector('.download-record');
    recordedVideo = document.querySelector('.recorded-video');
    
    startButton.addEventListener('click', startRecording);
    stopButton.addEventListener('click', stopRecording);

    // Initialize payment related elements if needed
    if (typeof PaystackPop !== 'undefined') {
        // Paystack specific initialization
        const paystackButton = document.createElement('button');
        paystackButton.textContent = 'Pay with Paystack';
        paystackButton.className = 'bg-yellow-500 px-4 py-2 rounded ml-4';
        paystackButton.onclick = () => paystackHandler('basic_plan');
        document.querySelector('.absolute.top-4.right-4').appendChild(paystackButton);
    }

    // Existing code...
    checkDeviceCompatibility();
});

// Subscription management
const manageSubscription = async () => {
    if (!supabaseInstance.auth.getUser().then(data => data.data.user)) return alert('Please login first!');

    showLoader();
    try {
        if (isPremiumUser) {
            const response = await fetch('/.netlify/functions/create-portal-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uid: supabaseInstance.auth.getUser().then(data => data.data.user.id) })
            });
            const session = await response.json();
            window.location.href = session.url;
        } else {
            handleSubscribe('price_123');
        }
    } catch (err) {
        alert('Subscription management error: ' + err.message);
    } finally {
        hideLoader();
    }
};

// Cloud save functionality
const saveToCloud = async () => {
    const { data: { user } } = await supabaseInstance.auth.getUser()
    if (!user) {
        alert('Please login to save recordings')
        return
    }
    
    showLoader()
    try {
        // Check file size
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        if (currentBlob.size > MAX_FILE_SIZE) {
            throw new Error('File size exceeds 50MB limit');
        }

        // Create a unique filename
        const timestamp = Date.now();
        const fileName = `recordings/${user.id}/${timestamp}.webm`;

        // Upload with content-type header
        const { error: uploadError, data } = await supabaseInstance.storage
            .from('recordings')
            .upload(fileName, currentBlob, {
                contentType: 'video/webm',
                cacheControl: '3600',
                upsert: false
            });
            
        if (uploadError) throw uploadError;
        
        // Get public URL
        const { data: { publicUrl } } = supabaseInstance.storage
            .from('recordings')
            .getPublicUrl(fileName);
            
        // Save record to database
        const { error: dbError } = await supabaseInstance
            .from('recordings')
            .insert({
                user_id: user.id,
                url: publicUrl,
                duration: recordedVideo.duration,
                created_at: new Date().toISOString(),
                file_name: fileName,
                file_size: currentBlob.size
            });
            
        if (dbError) throw dbError;
        
        alert('Recording saved successfully!');
        loadDashboard();
    } catch (err) {
        console.error('Upload error:', err);
        if (err.message.includes('size')) {
            alert('Error: File size exceeds 50MB limit. Try trimming the video or exporting at a lower quality.');
        } else if (err.statusCode === 413) {
            alert('Error: File too large for upload. Try trimming the video or exporting at a lower quality.');
        } else {
            alert('Error saving recording: ' + err.message);
        }
    } finally {
        hideLoader();
    }
};

// Add this helper function for copying share link
const copyShareLink = () => {
    const shareUrl = document.getElementById('share-url');
    shareUrl.select();
    document.execCommand('copy');
    alert('Link copied to clipboard!');
};

// Update generateShareLink function
const generateShareLink = async () => {
    const { data: { user } } = await supabaseInstance.auth.getUser();
    if (!user) return alert('Please login first!');
    
    const blobToShare = editedBlob || currentBlob;
    if (!blobToShare) return;

    showLoader();
    try {
        // Check file size
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        if (blobToShare.size > MAX_FILE_SIZE) {
            throw new Error('File size exceeds 50MB limit');
        }

        const timestamp = Date.now();
        const fileName = `shared/${user.id}/${timestamp}.webm`;
        
        const { error: uploadError, data } = await supabaseInstance.storage
            .from('recordings')
            .upload(fileName, blobToShare, {
                contentType: 'video/webm',
                cacheControl: '3600',
                upsert: false
            });
            
        if (uploadError) throw uploadError;
        
        const { data: { publicUrl } } = supabaseInstance.storage
            .from('recordings')
            .getPublicUrl(fileName);

        const shareLink = document.getElementById('share-link');
        const shareUrl = document.getElementById('share-url');
        shareUrl.value = publicUrl;
        shareLink.classList.remove('hidden');
    } catch (err) {
        console.error('Share error:', err);
        if (err.message.includes('size')) {
            alert('Error: File size exceeds 50MB limit. Try trimming the video or exporting at a lower quality.');
        } else if (err.statusCode === 413) {
            alert('Error: File too large for upload. Try trimming the video or exporting at a lower quality.');
        } else {
            alert('Sharing failed: ' + err.message);
        }
    } finally {
        hideLoader();
    }
};

// Video editing functions
const applyTrim = async () => {
    const start = document.getElementById('trim-start').value;
    const end = document.getElementById('trim-end').value;
    
    if (!start || !end) return alert('Please enter trim values');
    
    showLoader();
    try {
        const { createFFmpeg, fetchFile } = FFmpeg;
        const ffmpeg = createFFmpeg({ log: true });
        await ffmpeg.load();

        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(currentBlob));
        await ffmpeg.run('-i', 'input.mp4', '-ss', start, '-to', end, 'output.mp4');
        
        const data = ffmpeg.FS('readFile', 'output.mp4');
        editedBlob = new Blob([data.buffer], { type: 'video/mp4' });
        
        recordedVideo.src = URL.createObjectURL(editedBlob);
        recordedVideo.load();
        recordedVideo.play();
    } catch (err) {
        alert('Error trimming video: ' + err.message);
    } finally {
        hideLoader();
    }
};

const addTextOverlay = async () => {
    const text = document.getElementById('overlay-text').value;
    if (!text) return;
    
    showLoader();
    try {
        const { createFFmpeg, fetchFile } = FFmpeg;
        const ffmpeg = createFFmpeg({ log: true });
        await ffmpeg.load();

        ffmpeg.FS('writeFile', 'input.mp4', await fetchFile(editedBlob || currentBlob));
        await ffmpeg.run('-i', 'input.mp4', '-vf', 
            `drawtext=text='${text}':x=10:y=10:fontsize=24:fontcolor=white`,
            '-codec:a', 'copy', 'output.mp4');
        
        const data = ffmpeg.FS('readFile', 'output.mp4');
        editedBlob = new Blob([data.buffer], { type: 'video/mp4' });
        
        recordedVideo.src = URL.createObjectURL(editedBlob);
        recordedVideo.load();
        recordedVideo.play();
        textOverlays.push(text);
    } catch (err) {
        alert('Error adding text: ' + err.message);
    } finally {
        hideLoader();
    }
};

const exportVideo = async (format) => {
    const blobToExport = editedBlob || currentBlob;
    if (!blobToExport) return;
    
    showLoader();
    try {
        const url = URL.createObjectURL(blobToExport);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recording.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        alert('Export error: ' + err.message);
    } finally {
        hideLoader();
    }
};

// Add this function to toggle between recording and dashboard views
const toggleRecording = () => {
    document.getElementById('recording-section').classList.toggle('hidden');
    document.getElementById('dashboard').classList.add('hidden');
    // Close mobile menu if open
    if (window.innerWidth <= 768) {
        document.querySelector('.sidebar').classList.remove('active');
    }
};

// Move all window assignments to the end of the file
document.addEventListener('DOMContentLoaded', () => {
    // Export functions to window object
    Object.assign(window, {
        toggleDashboard,
        saveToCloud,
        applyTrim,
        addTextOverlay,
        exportVideo,
        generateShareLink,
        manageSubscription,
        toggleRecording,
        signInWithGoogle
    });

    // Login form handler
    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
        e.preventDefault()
        const email = document.getElementById('login-email').value
        const password = document.getElementById('login-password').value
        await signInWithEmail(email, password)
        document.getElementById('auth-modal').classList.add('hidden')
    })

    // Signup form handler
    document.getElementById('signup-form')?.addEventListener('submit', async (e) => {
        e.preventDefault()
        const email = document.getElementById('signup-email').value
        const password = document.getElementById('signup-password').value
        await signUpWithEmail(email, password)
        document.getElementById('auth-modal').classList.add('hidden')
    })

    // Close modal button handler
    document.querySelector('.close-modal')?.addEventListener('click', () => {
        document.getElementById('auth-modal').classList.add('hidden')
    })

    // Export functions to window
    Object.assign(window, {
        toggleDashboard,
        saveToCloud,
        applyTrim,
        addTextOverlay,
        exportVideo,
        generateShareLink,
        manageSubscription,
        toggleRecording,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        toggleAuthMode
    })
});

// Add after Firebase initialization
const signInWithGoogle = async () => {
    showLoader();
    try {
        const { data, error } = await supabaseInstance.auth.signInWithOAuth({
            provider: 'google'
        })
        if (error) throw error
    } catch (err) {
        console.error('Auth error:', err)
        alert('Authentication failed: ' + err.message)
    } finally {
        hideLoader();
    }
}

// Add Supabase auth listener
supabaseInstance.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') {
        checkUser()
    } else if (event === 'SIGNED_OUT') {
        authButton.textContent = 'Login'
        premiumBadge.classList.add('hidden')
    }
})

// Update the signInWithEmail function
const signInWithEmail = async (email, password) => {
    showLoader();
    try {
        const { data, error } = await supabaseInstance.auth.signInWithPassword({
            email,
            password,
        })
        if (error) throw error
        document.getElementById('auth-modal').classList.add('hidden')
        checkUser()
    } catch (err) {
        console.error('Login error:', err)
        alert('Login failed: ' + err.message)
    } finally {
        hideLoader();
    }
}

// Update the signUpWithEmail function
const signUpWithEmail = async (email, password) => {
    showLoader();
    try {
        const { data, error } = await supabaseInstance.auth.signUp({
            email,
            password,
        })
        if (error) throw error
        alert('Check your email for verification link!')
        document.getElementById('auth-modal').classList.add('hidden')
    } catch (err) {
        console.error('Signup error:', err)
        alert('Signup failed: ' + err.message)
    } finally {
        hideLoader();
    }
}


