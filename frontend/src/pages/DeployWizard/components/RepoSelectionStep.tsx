import React, { useState, useEffect } from 'react';
import { Github, Search, Globe, Lock, Loader2 } from 'lucide-react';
import { Repository } from '../types';
import { fetchGithubRepos } from '../../../services/byoa';

interface Props {
  onNext: (repo: Repository) => void;
}

export const RepoSelectionStep: React.FC<Props> = ({ onNext }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [customRepo, setCustomRepo] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // Check url params for error
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('error') === 'github_auth_failed') {
      setError('GitHub authentication failed. Please try again.');
    }

    // Attempt to fetch repos. If it succeeds, the user is connected.
    const loadRepos = async () => {
      try {
        const data = await fetchGithubRepos();
        if (data && data.length > 0) {
          setRepos(data);
          setIsConnected(true);
        } else {
          // Connected but 0 repos
          setIsConnected(true);
        }
      } catch (err) {
        // Not connected or error fetching
        setIsConnected(false);
      } finally {
        setIsLoading(false);
      }
    };

    loadRepos();
  }, []);

  const handleConnect = () => {
    window.location.href = '/api/byoa/github/auth';
  };

  const filteredRepos = repos.filter(repo => 
    repo.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-in fade-in zoom-in duration-500">
        <div className="w-24 h-24 mb-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center relative group cursor-pointer hover:bg-white/10 transition-colors">
          <div className="absolute inset-0 rounded-full bg-purple-500/20 blur-xl group-hover:bg-purple-500/30 transition-colors" />
          <Github className="w-12 h-12 text-white relative z-10" />
        </div>
        <h2 className="text-4xl font-bold mb-4 text-center">Connect your GitHub</h2>
        <p className="text-gray-400 mb-8 text-center max-w-md">
          Authorize access to your repositories to instantly deploy your code to our high-performance edge network.
        </p>
        {error && <p className="text-red-400 mb-4">{error}</p>}
        <button 
          onClick={handleConnect}
          className="px-8 py-4 bg-white text-black rounded-full font-semibold text-lg flex items-center space-x-3 hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)]"
        >
          <Github className="w-5 h-5" />
          <span>Continue with GitHub</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto animate-in slide-in-from-bottom-8 fade-in duration-500">
      <div className="bg-[#0A0A0A] border border-white/10 rounded-2xl p-1 overflow-hidden shadow-2xl relative">
        {/* Search Header */}
        <div className="p-4 border-b border-white/10 flex items-center bg-white/[0.02]">
          <Search className="w-5 h-5 text-gray-500 mr-3" />
          <input 
            type="text" 
            placeholder="Search repositories..." 
            className="bg-transparent border-none outline-none text-white w-full placeholder:text-gray-600 text-lg"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Repo List */}
        <div className="max-h-[400px] overflow-y-auto custom-scrollbar p-2 space-y-1">
          {filteredRepos.map(repo => (
            <button
              key={repo.id}
              onClick={() => onNext(repo)}
              className="w-full text-left p-4 rounded-xl hover:bg-white/5 transition-colors flex items-center justify-between group"
            >
              <div className="flex items-center space-x-4">
                <div className="p-2 rounded-lg bg-white/5 text-gray-400 group-hover:text-white transition-colors">
                  <Github className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-medium text-gray-200 group-hover:text-white transition-colors flex items-center space-x-2">
                    <span>{repo.name}</span>
                    {repo.private ? (
                      <Lock className="w-3 h-3 text-gray-500" />
                    ) : (
                      <Globe className="w-3 h-3 text-gray-500" />
                    )}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">Updated {new Date(repo.updatedAt).toLocaleDateString()}</p>
                </div>
              </div>
              <div className="px-4 py-2 rounded-lg bg-white/5 text-sm font-medium text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                Deploy
              </div>
            </button>
          ))}
          {filteredRepos.length === 0 && (
            <div className="p-8 text-center text-gray-500">
              No repositories found matching "{searchQuery}"
            </div>
          )}
        </div>

        {/* Custom Repo Input */}
        <div className="p-4 border-t border-white/10 bg-white/[0.02]">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Or deploy from a public URL</h3>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="https://github.com/username/repo"
              className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-purple-500/50 transition-colors"
              value={customRepo}
              onChange={(e) => setCustomRepo(e.target.value)}
            />
            <button
              onClick={() => {
                if (customRepo.trim()) {
                  onNext({
                    id: `custom-${Date.now()}`,
                    name: customRepo.trim().split('/').pop() || 'custom-repo',
                    fullName: customRepo.trim(),
                    private: false,
                    url: customRepo.trim(),
                    updatedAt: new Date().toISOString()
                  });
                }
              }}
              disabled={!customRepo.trim()}
              className="px-6 py-3 bg-white text-black font-semibold rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Deploy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
