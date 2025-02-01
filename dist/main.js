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

// Enhanced setupStream with browser checks
const setupStream = async () => {
    showLoader();
  try {
        if (!navigator.mediaDevices?.getDisplayMedia) {
            throw new Error('Screen recording not supported in this browser');
        }

      stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30 }
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

const setupVideoFeedback = () => {
    if (stream) {
        const video = document.querySelector('.video-feedback');
        video.srcObject = stream;
        video.play();
    } else {
        console.warn("no stream variable")
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

// Modified startRecording
const startRecording = async () => {
    await setupStream();
    if (!stream) return;

    const processedStream = addWatermark(stream);
    mixedStream = new MediaStream([
        ...processedStream.getTracks(),
        ...audio.getTracks()
    ]);

    recorder = new MediaRecorder(mixedStream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 2500000
    });

        recorder.ondataavailable = handleDataAvailable;
        recorder.onstop = handleStop;
        recorder.start(200);

        startButton.disabled = true;
    stopButton.disabled = false;

    if (!isPremiumUser) {
        startRecordingTimer();
    }

    console.log('recording started');
};

const handleDataAvailable = (e) => {
    chunks.push(e.data);
}

const handleStop = () => {
    const blob = new Blob(chunks, { 
        type: "video/webm; codecs=vp9" // Update MIME type to match recording
    });
    chunks = [];
    currentBlob = blob;

    const url = URL.createObjectURL(blob);
    downloadButton.href = url;
    downloadButton.download = 'video.webm'; // Change extension to match format
    downloadButton.disabled = false;

    recordedVideo.src = url;
    recordedVideo.load();
    recordedVideo.onloadeddata = () => {
        recordedVideo.play();
        const rc = document.querySelector(".recorded-video-wrap");
        rc.classList.remove("hidden");
        document.querySelector('.edit-tools').classList.remove('hidden');
        rc.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    if (audio) {
        audio.getTracks().forEach(track => track.stop());
    }

    console.log('recording ready');
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

const stopRecording = () => {
    if (recordingTimer) clearInterval(recordingTimer);
    recorder.stop();
    startButton.disabled = false;
    stopButton.disabled = true;
    console.log("Video stopped");
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
        const fileName = `recordings/${user.id}/${Date.now()}.webm`
        const { error: uploadError } = await supabaseInstance.storage
            .from('recordings')
            .upload(fileName, currentBlob)
            
        if (uploadError) throw uploadError
        
        const { data: { publicUrl } } = supabaseInstance.storage
            .from('recordings')
            .getPublicUrl(fileName)
            
        const { error: dbError } = await supabaseInstance
            .from('recordings')
            .insert({
                user_id: user.id,
                url: publicUrl,
                duration: recordedVideo.duration,
                created_at: new Date().toISOString()
            })
            
        if (dbError) throw dbError
        
        alert('Recording saved successfully!')
        loadDashboard()
    } catch (err) {
        alert('Error saving recording: ' + err.message)
    } finally {
        hideLoader()
    }
}

// Sharing functionality
const generateShareLink = async () => {
    if (!supabaseInstance.auth.getUser().then(data => data.data.user)) return alert('Please login first!');
    
    const blobToShare = editedBlob || currentBlob;
    if (!blobToShare) return;

    showLoader();
    try {
        const storageRef = supabaseInstance.storage.from('recordings');
        const shareRef = storageRef.child(
            `shared/${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`
        );
        
        await shareRef.put(blobToShare);
        const shareUrl = await shareRef.getDownloadURL();
        
        const shareDiv = document.getElementById('share-link');
        shareDiv.innerHTML = `
            <p class="mb-2">Shareable Link:</p>
            <input type="text" value="${shareUrl}" 
                   class="bg-gray-700 text-white px-2 py-1 rounded w-full mb-2" readonly>
            <button onclick="navigator.clipboard.writeText('${shareUrl}')" 
                    class="bg-gray-500 px-2 py-1 rounded">
                Copy Link
            </button>
        `;
        shareDiv.classList.remove('hidden');
    } catch (err) {
        alert('Sharing failed: ' + err.message);
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


