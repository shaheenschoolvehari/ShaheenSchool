'use client';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';

const API = process.env.NEXT_PUBLIC_API_URL || "https://shaheenschool.onrender.com";

interface StudentMember {
    student_id: number;
    admission_no: string;
    first_name: string;
    last_name: string;
    full_name: string;
    category?: string;
    is_trusted?: boolean;
    monthly_fee?: number;
    father_name: string;
    father_phone: string;
    father_cnic: string;
    mother_name: string;
    mother_phone: string;
    mother_cnic: string;
    guardian_name: string;
    guardian_phone: string;
    current_address: string;
    class_id: number;
    class_name: string;
    section_id: number;
    section_name: string;
    status: string;
}

interface FatherInfo {
    name: string;
    phone: string;
    cnic: string;
    count: number;
}

interface FamilyData {
    family_id: string;
    family_name: string;
    father_name: string;
    mother_name: string;
    father_phone: string;
    mother_phone: string;
    guardian_phone: string;
    primary_phone: string;
    is_cousin_family?: boolean;
    is_trusted_family?: boolean;
    has_trusted_members?: boolean;
    fathers_list?: FatherInfo[];
    combined_father_names?: string;
    combined_phones?: string;
    total_children: number;
    children_names: string[];
    classes_list: string[];
    sections_list: string[];
    family_fee: number;
    effective_monthly_fee?: number;
    opening_balance: number;
    opening_balance_paid?: number;
    opb_remaining?: number;
    total_billed?: number;
    total_paid?: number;
    total_balance?: number;
    fee_status?: 'unpaid' | 'partial' | 'paid' | 'settled' | 'satteled' | string;
    members: StudentMember[];
    eldest_child?: StudentMember | null;
}

interface SchoolInfo {
    school_name: string;
    school_address: string;
    phone_number: string;
    school_phone2: string;
    school_phone3: string;
    school_logo_url: string;
}

interface ClassItem {
    class_id: number;
    class_name: string;
}

interface SectionItem {
    section_id: number;
    section_name: string;
    class_id: number;
}

interface ActiveAcademicYear {
    id: number;
    year_name: string;
    is_active?: boolean;
}

export default function FamilyListPage() {
    const router = useRouter();
    const [families, setFamilies] = useState<FamilyData[]>([]);
    const [classes, setClasses] = useState<ClassItem[]>([]);
    const [sections, setSections] = useState<SectionItem[]>([]);
    const [activeYear, setActiveYear] = useState<ActiveAcademicYear | null>(null);
    const [stats, setStats] = useState<{ total_families: number; total_students: number; average_family_size: number | string } | null>(null);
    const [school, setSchool] = useState<SchoolInfo>({
        school_name: '', school_address: '', phone_number: '', school_phone2: '', school_phone3: '', school_logo_url: ''
    });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedClass, setSelectedClass] = useState('');
    const [selectedSection, setSelectedSection] = useState('');
    const [showFeeColumns, setShowFeeColumns] = useState(false);
    const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

    // Pagination state (default: 50 families per page for maximum speed & responsiveness)
    const [currentPage, setCurrentPage] = useState<number>(1);
    const [pageSize, setPageSize] = useState<number>(50);

    // Fetch initial datasets
    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                // 1. Fetch Active Academic Year
                fetch(`${API}/academic/active-year`)
                    .then(r => r.json())
                    .then(data => {
                        if (data && data.id) setActiveYear(data);
                    })
                    .catch(() => { });

                // 2. Fetch Classes
                fetch(`${API}/academic`)
                    .then(r => r.json())
                    .then(data => setClasses(Array.isArray(data) ? data : []))
                    .catch(() => { });

                // 3. Fetch Sections
                fetch(`${API}/academic/sections`)
                    .then(r => r.json())
                    .then(data => setSections(Array.isArray(data) ? data : []))
                    .catch(() => { });

                // 4. Fetch School Settings
                fetch(`${API}/settings`)
                    .then(r => r.json())
                    .then((data: any) => {
                        if (data && typeof data === 'object' && !Array.isArray(data)) {
                            const getLogo = (raw?: string) => {
                                if (!raw || !raw.trim()) return `${API}/icon.png`;
                                const s = raw.trim();
                                if (s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://')) return s;
                                return `${API}/${s.replace(/^\/+/, '')}`;
                            };
                            setSchool({
                                school_name: data.school_name || 'Smart School System',
                                school_address: data.address || 'Main Campus',
                                phone_number: data.contact_number || '',
                                school_phone2: '',
                                school_phone3: '',
                                school_logo_url: getLogo(data.logo_url)
                            });
                        }
                    })
                    .catch(() => { });

                // 5. Fetch Families Directory
                const res = await fetch(`${API}/students/families-directory`);
                const data = await res.json();
                if (res.ok) {
                    setFamilies(data.families || []);
                    setStats(data.stats || null);
                } else {
                    console.error("Failed to load families:", data.error);
                }
            } catch (err) {
                console.error("Error loading families directory:", err);
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, []);

    // Filter available sections based on selected class
    const availableSections = useMemo(() => {
        if (!selectedClass) {
            const uniqueNames = Array.from(new Set(sections.map(s => s.section_name)));
            return uniqueNames.map(name => ({
                section_id: sections.find(s => s.section_name === name)?.section_id || 0,
                section_name: name,
                class_id: 0
            }));
        }
        const classIdNum = parseInt(selectedClass, 10);
        return sections.filter(s => s.class_id === classIdNum);
    }, [sections, selectedClass]);

    // Handle class filter change & reset section
    const handleClassChange = (newClassId: string) => {
        setSelectedClass(newClassId);
        setSelectedSection('');
    };

    // Helper: Identify the Eldest Child (Lead Student) representing the family unit
    // Seniority is determined by:
    // 1. ACTIVE students strictly (an inactive child cannot lead or represent a family unit)
    // 2. Highest class level (class_id DESC), then earliest admission
    const getEldestChild = (members: StudentMember[]): StudentMember | null => {
        if (!members || members.length === 0) return null;
        const activeMembers = members.filter(m => (m.status || 'Active').toLowerCase() === 'active');
        if (activeMembers.length === 0) return null;
        return activeMembers.reduce((eldest, curr) => {
            if (!eldest) return curr;
            const diff = (curr.class_id || 0) - (eldest.class_id || 0);
            if (diff > 0) return curr;
            if (diff < 0) return eldest;
            return eldest;
        }, activeMembers[0]);
    };

    // Calculate Sibling vs Cousin breakdown stats
    const familyCounts = useMemo(() => {
        let pureSiblings = 0;
        let cousins = 0;
        families.forEach(f => {
            const activeM = (f.members || []).filter(m => (m.status || 'Active').toLowerCase() === 'active');
            if (activeM.length === 0) return;
            if (f.is_cousin_family || (f.fathers_list && f.fathers_list.length > 1)) {
                cousins++;
            } else {
                pureSiblings++;
            }
        });
        return { pureSiblings, cousins };
    }, [families]);

    // Filter & Project Families:
    // Core Rule: When filtering by Class/Section, a family is matched IF AND ONLY IF its
    // ELDEST/LEAD CHILD is in that selected Class/Section. When matched, the WHOLE FAMILY
    // (with all younger siblings) is displayed together!
    const filteredFamilies = useMemo(() => {
        const s = searchTerm.toLowerCase().trim();
        const hasClassFilter = Boolean(selectedClass);
        const hasSectionFilter = Boolean(selectedSection);

        const list = families
            .map(fam => {
                // Strictly consider only ACTIVE members of the family
                const activeMembers = (fam.members || []).filter(m => (m.status || 'Active').toLowerCase() === 'active');
                if (activeMembers.length === 0) return null;

                // 1. Text Search matching
                const matchesSearch = !s || (
                    fam.family_id.toLowerCase().includes(s) ||
                    fam.family_name.toLowerCase().includes(s) ||
                    (fam.combined_father_names && fam.combined_father_names.toLowerCase().includes(s)) ||
                    fam.father_name.toLowerCase().includes(s) ||
                    fam.mother_name.toLowerCase().includes(s) ||
                    fam.father_phone.includes(s) ||
                    fam.mother_phone.includes(s) ||
                    (fam.combined_phones && fam.combined_phones.includes(s)) ||
                    activeMembers.some(m => m.full_name.toLowerCase().includes(s) || m.admission_no.toLowerCase().includes(s)) ||
                    (fam.fathers_list && fam.fathers_list.some(f => f.name.toLowerCase().includes(s) || f.phone.includes(s)))
                );

                if (!matchesSearch) return null;

                // 2. Determine Eldest Child (Lead Student) of the Family (active only)
                const eldest = getEldestChild(activeMembers);

                // 3. Class & Section filter applied ONLY to the Eldest Child representing the family
                if (hasClassFilter) {
                    const matchC = eldest && (
                        eldest.class_id?.toString() === selectedClass ||
                        eldest.class_name.toLowerCase() === selectedClass.toLowerCase()
                    );
                    if (!matchC) return null;
                }

                if (hasSectionFilter) {
                    const matchS = eldest && (
                        eldest.section_id?.toString() === selectedSection ||
                        eldest.section_name.toLowerCase() === selectedSection.toLowerCase()
                    );
                    if (!matchS) return null;
                }

                // Sort members inside family:
                // Sorted by Class DESC (highest class active child is Lead), Section & Name.
                const sortedMembers = [...activeMembers].sort((a, b) => {
                    const cDiff = (b.class_id || 0) - (a.class_id || 0);
                    if (cDiff !== 0) return cDiff;
                    const sComp = (a.section_name || '').localeCompare(b.section_name || '');
                    if (sComp !== 0) return sComp;
                    return (a.first_name || '').localeCompare(b.first_name || '');
                });

                return {
                    ...fam,
                    total_children: sortedMembers.length,
                    eldest_child: eldest,
                    activeMembers: sortedMembers,
                    isFilteredChildCount: false
                };
            })
            .filter((item): item is FamilyData & { eldest_child: StudentMember | null; activeMembers: StudentMember[]; isFilteredChildCount: boolean } => item !== null);

        // Sorting Priority:
        return list.sort((a, b) => {
            if (!hasClassFilter && !hasSectionFilter && !s) {
                // Class-wise & Section-wise priority of lead student
                const clsA = a.eldest_child?.class_name || a.activeMembers[0]?.class_name || '';
                const clsB = b.eldest_child?.class_name || b.activeMembers[0]?.class_name || '';
                const clsCompare = clsA.localeCompare(clsB, undefined, { numeric: true, sensitivity: 'base' });
                if (clsCompare !== 0) return clsCompare;

                const secA = a.eldest_child?.section_name || a.activeMembers[0]?.section_name || '';
                const secB = b.eldest_child?.section_name || b.activeMembers[0]?.section_name || '';
                const secCompare = secA.localeCompare(secB, undefined, { numeric: true, sensitivity: 'base' });
                if (secCompare !== 0) return secCompare;

                // Then Family Name alphabetically
                return a.family_name.localeCompare(b.family_name, undefined, { sensitivity: 'base' });
            }

            // When filters applied, alphabetical by family/father name
            return a.family_name.localeCompare(b.family_name, undefined, { sensitivity: 'base' });
        });
    }, [families, searchTerm, selectedClass, selectedSection]);

    // Reset pagination to page 1 whenever search, class, or section changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, selectedClass, selectedSection, pageSize]);

    // Pagination calculations
    const totalPages = Math.max(1, Math.ceil(filteredFamilies.length / (pageSize === -1 ? filteredFamilies.length || 1 : pageSize)));

    const paginatedFamilies = useMemo(() => {
        if (pageSize === -1) return filteredFamilies;
        const start = (currentPage - 1) * pageSize;
        return filteredFamilies.slice(start, start + pageSize);
    }, [filteredFamilies, currentPage, pageSize]);

    // Total displayed student count across all filtered families
    const displayedStudentsCount = useMemo(() => {
        return filteredFamilies.reduce((acc, f) => acc + f.activeMembers.length, 0);
    }, [filteredFamilies]);

    // Format phone for WhatsApp URL (e.g. 03001234567 -> 923001234567)
    const formatWhatsAppNumber = (phone?: string) => {
        if (!phone) return '';
        const cleaned = phone.replace(/[^0-9]/g, '');
        if (cleaned.startsWith('0')) {
            return '92' + cleaned.substring(1);
        }
        if (cleaned.startsWith('92')) {
            return cleaned;
        }
        return cleaned ? '92' + cleaned : '';
    };

    // ── Export Functions ──────────────────────────────────────────────

    // 1. Export Excel (Strictly reflects filtered families, entire children list, Fee & OPB)
    const exportExcel = () => {
        if (filteredFamilies.length === 0) return;

        const excelData: any[] = [];
        let sr = 1;

        filteredFamilies.forEach(f => {
            const isSettled = (f.is_trusted_family && (f.total_balance || 0) <= 0 && (f.total_billed || 0) <= 0) || ['settled', 'satteled'].includes((f.fee_status || '').toLowerCase());
            const monthlyFeeVal = f.effective_monthly_fee || f.family_fee || 0;
            const opbVal = f.opb_remaining !== undefined ? f.opb_remaining : (f.opening_balance || 0);

            f.activeMembers.forEach((m) => {
                const isMemberTrusted = m.is_trusted || (m.category || '').toLowerCase() === 'trusted';
                const rowObj: any = {
                    "Sr.#": sr,
                    "Family Name": f.is_cousin_family ? (f.combined_father_names || f.family_name || '') : (f.family_name || ''),
                    "Family ID": f.family_id,
                    "Family Type": f.is_cousin_family ? "Siblings + Cousins" : "Pure Siblings",
                    "Lead / Eldest Child": f.eldest_child ? `${f.eldest_child.full_name} (${f.eldest_child.class_name})` : "N/A",
                    "Monthly Fee (PKR)": monthlyFeeVal,
                    "OPB Arrears (PKR)": opbVal,
                };

                if (showFeeColumns) {
                    rowObj["Fee Status"] = isSettled ? "FREE TUITION" : (f.fee_status ? f.fee_status.toUpperCase() : "PAID");
                    rowObj["Total Bill (PKR)"] = isSettled ? 0 : (f.total_billed || 0);
                    rowObj["Paid (PKR)"] = isSettled ? 0 : (f.total_paid || 0);
                    rowObj["Balance (PKR)"] = isSettled ? 0 : (f.total_balance || 0);
                }

                rowObj["Student Name"] = m.full_name;
                rowObj["Category"] = isMemberTrusted ? "Trusted" : (m.category || "Normal");
                rowObj["Admission No"] = m.admission_no;
                rowObj["Class"] = m.class_name;
                rowObj["Section"] = m.section_name;
                rowObj["Father Name"] = m.father_name || f.father_name || "N/A";
                rowObj["Mother Name"] = m.mother_name || f.mother_name || "N/A";
                rowObj["Father Phone"] = m.father_phone || f.father_phone || "N/A";
                rowObj["Mother Phone"] = m.mother_phone || f.mother_phone || "N/A";
                rowObj["Current Address"] = m.current_address || "N/A";

                excelData.push(rowObj);
            });
            sr++;
        });

        const ws = XLSX.utils.json_to_sheet(excelData);
        const colWidths = [
            { wch: 6 },  // Sr
            { wch: 26 }, // Family Name
            { wch: 14 }, // Family ID
            { wch: 18 }, // Family Type
            { wch: 24 }, // Lead Child
            { wch: 16 }, // Monthly Fee
            { wch: 16 }, // OPB Arrears
        ];

        if (showFeeColumns) {
            colWidths.push(
                { wch: 12 }, // Fee Status
                { wch: 16 }, // Total Bill
                { wch: 14 }, // Paid
                { wch: 14 }  // Balance
            );
        }

        colWidths.push(
            { wch: 25 }, // Student Name
            { wch: 12 }, // Category
            { wch: 15 }, // Admission No
            { wch: 14 }, // Class
            { wch: 10 }, // Section
            { wch: 22 }, // Father Name
            { wch: 22 }, // Mother Name
            { wch: 16 }, // Father Phone
            { wch: 16 }, // Mother Phone
            { wch: 30 }  // Current Address
        );

        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Family Directory");
        const dateStr = new Date().toISOString().split('T')[0];
        const filterTag = selectedClass ? `_Class_${selectedClass}` : '';
        XLSX.writeFile(wb, `${school.school_name || 'School'}_Family_Directory${filterTag}_${dateStr}.xlsx`);
    };

    // 2. Export CSV
    const exportCSV = () => {
        if (filteredFamilies.length === 0) return;

        const headers = ["Sr.#", "Family Name", "Family ID", "Family Type", "Lead Child", "Monthly Fee", "OPB Arrears"];
        if (showFeeColumns) {
            headers.push("Fee Status", "Total Bill", "Paid", "Balance");
        }
        headers.push("Student Name", "Category", "Admission No", "Class", "Section", "Father Name", "Mother Name", "Father Phone", "Mother Phone", "Address");

        const rows: string[][] = [];
        let sr = 1;

        filteredFamilies.forEach(f => {
            const isSettled = (f.is_trusted_family && (f.total_balance || 0) <= 0 && (f.total_billed || 0) <= 0) || ['settled', 'satteled'].includes((f.fee_status || '').toLowerCase());
            const monthlyFeeVal = f.effective_monthly_fee || f.family_fee || 0;
            const opbVal = f.opb_remaining !== undefined ? f.opb_remaining : (f.opening_balance || 0);

            f.activeMembers.forEach(m => {
                const isMemberTrusted = m.is_trusted || (m.category || '').toLowerCase() === 'trusted';
                const row: string[] = [
                    sr.toString(),
                    `"${(f.is_cousin_family ? (f.combined_father_names || f.family_name || '') : (f.family_name || '')).replace(/"/g, '""')}"`,
                    `"${(f.family_id || '').replace(/"/g, '""')}"`,
                    `"${f.is_cousin_family ? 'Siblings + Cousins' : 'Pure Siblings'}"`,
                    `"${(f.eldest_child ? `${f.eldest_child.full_name} (${f.eldest_child.class_name})` : '').replace(/"/g, '""')}"`,
                    `"${monthlyFeeVal}"`,
                    `"${opbVal}"`
                ];

                if (showFeeColumns) {
                    row.push(
                        `"${isSettled ? 'FREE TUITION' : (f.fee_status || 'paid').toUpperCase()}"`,
                        `"${isSettled ? 0 : (f.total_billed || 0)}"`,
                        `"${isSettled ? 0 : (f.total_paid || 0)}"`,
                        `"${isSettled ? 0 : (f.total_balance || 0)}"`
                    );
                }

                row.push(
                    `"${(m.full_name || '').replace(/"/g, '""')}"`,
                    `"${isMemberTrusted ? 'Trusted' : (m.category || 'Normal')}"`,
                    `"${(m.admission_no || '').replace(/"/g, '""')}"`,
                    `"${(m.class_name || '').replace(/"/g, '""')}"`,
                    `"${(m.section_name || '').replace(/"/g, '""')}"`,
                    `"${(m.father_name || f.father_name || '').replace(/"/g, '""')}"`,
                    `"${(m.mother_name || f.mother_name || '').replace(/"/g, '""')}"`,
                    `"${(m.father_phone || f.father_phone || '').replace(/"/g, '""')}"`,
                    `"${(m.mother_phone || f.mother_phone || '').replace(/"/g, '""')}"`,
                    `"${(m.current_address || '').replace(/"/g, '""')}"`
                );

                rows.push(row);
            });
            sr++;
        });

        const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        const dateStr = new Date().toISOString().split('T')[0];
        link.setAttribute("download", `${school.school_name || 'School'}_Family_Directory_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // 3. Print / PDF Export
    const exportPDF = () => {
        if (filteredFamilies.length === 0) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) return;

        const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        const filterTitle = selectedClass ? ` - Lead Filter: Class ${selectedClass}${selectedSection ? ` (${selectedSection})` : ''}` : '';

        const tableRowsHtml = filteredFamilies.map((f, idx) => {
            const M = f.activeMembers.length;
            const isSettled = f.is_trusted_family || ['settled', 'satteled'].includes((f.fee_status || '').toLowerCase());
            const isCousin = f.is_cousin_family;
            const monthlyFeeVal = f.effective_monthly_fee || f.family_fee || 0;
            const opbVal = f.opb_remaining !== undefined ? f.opb_remaining : (f.opening_balance || 0);

            return f.activeMembers.map((m, mIdx) => {
                const isMemberTrusted = m.is_trusted || (m.category || '').toLowerCase() === 'trusted';
                if (mIdx === 0) {
                    return `
                        <tr style="border-top: 2px solid #215E61;">
                            <td rowspan="${M}" style="text-align: center; border: 1px solid #333; padding: 6px; font-weight: bold; vertical-align: middle; background-color: #fafafa;">${idx + 1}</td>
                            <td rowspan="${M}" style="border: 1px solid #333; padding: 6px; font-weight: bold; vertical-align: middle;">
                                <div style="font-size: 10pt; color: #233D4D;">${isCousin ? (f.combined_father_names || f.family_name) : f.family_name}</div>
                                <div style="font-size: 7.5pt; color: ${isCousin ? '#b45309' : '#047857'}; font-weight: 600; margin-top: 2px;">
                                    ${isCousin ? '🧬 SIBLINGS + COUSINS' : '👨‍👩‍👧‍👦 PURE SIBLINGS'}
                                </div>
                                ${isSettled ? `<div style="font-size: 7.5pt; color: #0891b2; font-weight: 700; margin-top: 1px;">🛡️ TRUSTED SETTLED</div>` : ''}
                                <div style="font-size: 8pt; color: #666; font-weight: normal; margin-top: 2px;">
                                    ${f.total_children} Child${f.total_children > 1 ? 'ren' : ''} in family
                                </div>
                            </td>
                            <td rowspan="${M}" style="text-align: center; border: 1px solid #333; padding: 6px; font-weight: bold; vertical-align: middle; background-color: #f8f9fa;">${f.family_id}</td>
                            <td rowspan="${M}" style="border: 1px solid #333; padding: 6px; vertical-align: middle; background-color: #fafafa;">
                                <div style="font-size: 8pt;"><strong>Monthly:</strong> PKR ${monthlyFeeVal.toLocaleString('en-PK')}</div>
                                <div style="font-size: 8pt; color: ${opbVal > 0 ? '#dc2626' : '#166534'}; margin-top: 2px;"><strong>OPB:</strong> PKR ${opbVal.toLocaleString('en-PK')}</div>
                            </td>
                            ${showFeeColumns ? `
                                <td rowspan="${M}" style="text-align: right; border: 1px solid #333; padding: 6px; font-weight: bold; vertical-align: middle;">PKR ${(isSettled ? 0 : (f.total_billed || 0)).toLocaleString('en-PK')}</td>
                                <td rowspan="${M}" style="text-align: right; border: 1px solid #333; padding: 6px; font-weight: bold; color: #198754; vertical-align: middle;">PKR ${(isSettled ? 0 : (f.total_paid || 0)).toLocaleString('en-PK')}</td>
                                <td rowspan="${M}" style="text-align: right; border: 1px solid #333; padding: 6px; font-weight: bold; color: ${isSettled ? '#0891b2' : (f.total_balance || 0) > 0 ? '#dc3545' : '#198754'}; vertical-align: middle;">${isSettled ? 'PKR 0 (Settled)' : `PKR ${(f.total_balance || 0).toLocaleString('en-PK')}`}</td>
                            ` : ''}
                            <td style="border: 1px solid #333; padding: 6px; font-weight: bold; color: #111;">
                                ${m.full_name} <span style="font-size: 8pt; color: #555; font-weight: normal;">(${m.admission_no})</span>
                                ${isMemberTrusted ? `<span style="font-size: 7.5pt; color: #0891b2; font-weight: bold; margin-left: 4px;">[Trusted]</span>` : ''}
                                ${isCousin ? `<div style="font-size: 7.5pt; color: #666; font-weight: normal;">Father: <strong>${m.father_name || 'N/A'}</strong></div>` : ''}
                            </td>
                            <td style="text-align: center; border: 1px solid #333; padding: 6px;">${m.class_name}</td>
                            <td style="text-align: center; border: 1px solid #333; padding: 6px;">${m.section_name}</td>
                            <td rowspan="${M}" style="border: 1px solid #333; padding: 6px; vertical-align: middle;">
                                ${isCousin && f.fathers_list && f.fathers_list.length > 0 ? (
                            f.fathers_list.map(fa => `<div><strong>${fa.name}</strong></div>`).join('')
                        ) : (
                            `<div><strong>Father:</strong> ${f.father_name || 'N/A'}</div>`
                        )}
                                ${f.mother_name && !isCousin ? `<div style="font-size: 8pt; color: #555;"><strong>Mother:</strong> ${f.mother_name}</div>` : ''}
                            </td>
                            <td rowspan="${M}" style="border: 1px solid #333; padding: 6px; vertical-align: middle; white-space: nowrap;">
                                ${isCousin && f.fathers_list && f.fathers_list.length > 0 ? (
                            f.fathers_list.map(fa => fa.phone ? `<div>${fa.name.split(' ')[0]}: ${fa.phone}</div>` : '').join('')
                        ) : (
                            `<div>${f.father_phone ? `Father: ${f.father_phone}` : ''}</div>
                             <div>${f.mother_phone ? `Mother: ${f.mother_phone}` : ''}</div>`
                        )}
                            </td>
                        </tr>
                    `;
                } else {
                    return `
                        <tr>
                            <td style="border: 1px solid #333; padding: 6px; font-weight: bold; color: #111;">
                                ${m.full_name} <span style="font-size: 8pt; color: #555; font-weight: normal;">(${m.admission_no})</span>
                                ${isMemberTrusted ? `<span style="font-size: 7.5pt; color: #0891b2; font-weight: bold; margin-left: 4px;">[Trusted]</span>` : ''}
                                ${isCousin ? `<div style="font-size: 7.5pt; color: #666; font-weight: normal;">Father: <strong>${m.father_name || 'N/A'}</strong></div>` : ''}
                            </td>
                            <td style="text-align: center; border: 1px solid #333; padding: 6px;">${m.class_name}</td>
                            <td style="text-align: center; border: 1px solid #333; padding: 6px;">${m.section_name}</td>
                        </tr>
                    `;
                }
            }).join('');
        }).join('');

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Family Directory Report - ${school.school_name || 'School'}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 12mm 10mm; color: #000; background: #fff; }
                    .header { display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }
                    .logo { width: 65px; height: 65px; object-fit: contain; margin-right: 15px; }
                    .school-name { font-size: 18pt; font-weight: bold; text-transform: uppercase; color: #233D4D; text-align: center; }
                    .school-sub { font-size: 9.5pt; text-align: center; margin-top: 3px; color: #444; }
                    .title-bar { background-color: #215E61; color: #fff; text-align: center; padding: 6px; font-size: 11pt; font-weight: bold; text-transform: uppercase; margin: 10px 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .meta-info { display: flex; justify-content: space-between; font-size: 9pt; margin-bottom: 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
                    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
                    th { background-color: #f0f4f5; border: 1px solid #333; padding: 6px; font-weight: bold; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    @page { size: A4 landscape; margin: 10mm; }
                </style>
            </head>
            <body>
                <div class="header">
                    ${school.school_logo_url ? `<img src="${school.school_logo_url}" class="logo" alt="Logo" />` : ''}
                    <div>
                        <div class="school-name">${school.school_name || 'Smart School System'}</div>
                        <div class="school-sub">${school.school_address} ${school.phone_number ? `| Ph: ${school.phone_number}` : ''}</div>
                    </div>
                </div>
                <div class="title-bar">FAMILY DIRECTORY & STUDENT LIST${filterTitle}</div>
                <div class="meta-info">
                    <div><strong>Total Families Listed:</strong> ${filteredFamilies.length} (${displayedStudentsCount} Students)</div>
                    <div><strong>Date Generated:</strong> ${dateStr}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 4%;">Sr.#</th>
                            <th style="width: 17%;">Family Information</th>
                            <th style="width: 9%;">Family ID</th>
                            <th style="width: 12%;">Fee & OPB</th>
                            ${showFeeColumns ? `
                                <th style="width: 7%;">Total Bill</th>
                                <th style="width: 7%;">Paid</th>
                                <th style="width: 7%;">Balance</th>
                            ` : ''}
                            <th style="width: 18%;">Student / Child Name</th>
                            <th style="width: 6%;">Class</th>
                            <th style="width: 6%;">Section</th>
                            <th style="width: 12%;">Parents / Guardians</th>
                            <th style="width: 15%;">Contacts & WhatsApp</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${tableRowsHtml}
                    </tbody>
                </table>
                <script>
                    window.onload = function() {
                        window.print();
                    }
                </script>
            </body>
            </html>
        `;

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
    };

    return (
        <div className="container-fluid p-2 p-sm-3 p-md-4 animate__animated animate__fadeIn">
            {/* Custom Responsive Styles for Family Directory */}
            <style jsx>{`
                @media (max-width: 767.98px) {
                    .family-stat-card .fs-4 {
                        font-size: 1.25rem !important;
                    }
                    .family-stat-card .fs-6 {
                        font-size: 0.85rem !important;
                    }
                    .family-table-container {
                        border-radius: 12px !important;
                    }
                    .family-table {
                        min-width: 860px;
                    }
                }
                @media (max-width: 575.98px) {
                    .family-stat-card {
                        padding: 10px !important;
                    }
                    .family-stat-card .bi {
                        font-size: 1.2rem !important;
                    }
                }
            `}</style>

            {/* Top Page Header (Academic Year Badge in top-right opposite Title) */}
            <div className="d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center mb-3 mb-md-4 gap-2 gap-md-3">
                <div>
                    <h2 className="fw-bold mb-1 d-flex align-items-center gap-2" style={{ color: 'var(--primary-dark)', fontSize: 'clamp(1.3rem, 3vw, 1.75rem)' }}>
                        <i className="bi bi-people-fill" style={{ color: 'var(--primary-teal)' }}></i>
                        Family Directory
                    </h2>
                    <p className="text-muted small mb-0">
                        Class & section lead-filtered family units, pure sibling vs cousin households, contacts, fee and opening balance directory.
                    </p>
                </div>

                {/* Academic Year Pill Badge Opposite Title */}
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    {activeYear && (
                        <div
                            className="badge d-inline-flex align-items-center gap-1.5 px-3 py-2 text-white shadow-sm"
                            style={{
                                backgroundColor: 'var(--primary-teal)',
                                borderRadius: '20px',
                                fontSize: '0.8rem',
                                letterSpacing: '0.3px'
                            }}
                        >
                            <i className="bi bi-calendar-check-fill"></i>
                            <span>Academic Session: <strong>{activeYear.year_name}</strong></span>
                        </div>
                    )}
                </div>
            </div>

            {/* 4 Summary Stat Squircle Cards */}
            <div className="row g-2 g-md-3 mb-3 mb-md-4">
                <div className="col-6 col-lg-3">
                    <div className="card border-0 shadow-sm h-100 family-stat-card" style={{ borderLeft: '4px solid var(--primary-teal)', borderRadius: '16px' }}>
                        <div className="card-body p-2.5 p-md-3">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <div className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem' }}>Total Families</div>
                                    <div className="fw-bold fs-4 mt-1" style={{ color: 'var(--primary-dark)' }}>{stats?.total_families || families.length}</div>
                                </div>
                                <div className="p-2 rounded-3 bg-light text-teal d-none d-sm-block" style={{ color: 'var(--primary-teal)' }}>
                                    <i className="bi bi-people fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-6 col-lg-3">
                    <div className="card border-0 shadow-sm h-100 family-stat-card" style={{ borderLeft: '4px solid var(--accent-orange)', borderRadius: '16px' }}>
                        <div className="card-body p-2.5 p-md-3">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <div className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem' }}>Total Students</div>
                                    <div className="fw-bold fs-4 mt-1" style={{ color: 'var(--accent-orange)' }}>{stats?.total_students || 0}</div>
                                </div>
                                <div className="p-2 rounded-3 bg-light text-warning d-none d-sm-block" style={{ color: 'var(--accent-orange)' }}>
                                    <i className="bi bi-backpack4 fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-6 col-lg-3">
                    <div className="card border-0 shadow-sm h-100 family-stat-card" style={{ borderLeft: '4px solid #3b82f6', borderRadius: '16px' }}>
                        <div className="card-body p-2.5 p-md-3">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <div className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem' }}>Household Structure</div>
                                    <div className="fw-bold fs-6 mt-1 text-primary text-truncate">
                                        {familyCounts.pureSiblings} <span className="text-muted small fw-normal">Sib</span> • {familyCounts.cousins} <span className="text-muted small fw-normal">Cousin</span>
                                    </div>
                                </div>
                                <div className="p-2 rounded-3 bg-light text-primary d-none d-sm-block">
                                    <i className="bi bi-diagram-3 fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="col-6 col-lg-3">
                    <div className="card border-0 shadow-sm h-100 family-stat-card" style={{ borderLeft: '4px solid #16a34a', borderRadius: '16px' }}>
                        <div className="card-body p-2.5 p-md-3">
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <div className="text-muted text-uppercase fw-bold" style={{ fontSize: '0.68rem' }}>Filtered Families</div>
                                    <div className="fw-bold fs-4 mt-1 text-success text-truncate">
                                        {filteredFamilies.length} <span className="fs-6 text-muted fw-normal">({displayedStudentsCount} kids)</span>
                                    </div>
                                </div>
                                <div className="p-2 rounded-3 bg-light text-success d-none d-sm-block">
                                    <i className="bi bi-funnel fs-4"></i>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Main Interactive Container */}
            <div className="card border-0 shadow-sm" style={{ borderRadius: '16px' }}>
                {/* Responsive Filter & Action Toolbar */}
                <div className="card-header bg-white border-bottom p-3" style={{ borderTopLeftRadius: '16px', borderTopRightRadius: '16px' }}>
                    <div className="row g-3 align-items-center justify-content-between">
                        {/* Search & Lead Class/Section Filters */}
                        <div className="col-12 col-xl-7">
                            <div className="row g-2">
                                {/* Search Input */}
                                <div className="col-12 col-md-5">
                                    <div className="input-group">
                                        <span className="input-group-text bg-light border-end-0" style={{ borderRadius: '12px 0 0 12px' }}>
                                            <i className="bi bi-search text-muted"></i>
                                        </span>
                                        <input
                                            type="text"
                                            className="form-control bg-light border-start-0"
                                            placeholder="Search family, father, child, phone..."
                                            value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                            style={{ borderRadius: '0 12px 12px 0', fontSize: '0.88rem' }}
                                        />
                                    </div>
                                </div>

                                {/* Class Filter (Filters by Eldest / Lead Child of the family) */}
                                <div className="col-6 col-md-3">
                                    <select
                                        className="form-select bg-light border"
                                        value={selectedClass}
                                        onChange={e => handleClassChange(e.target.value)}
                                        style={{ borderRadius: '12px', fontSize: '0.88rem' }}
                                        title="Filter families where Eldest Child is in this class"
                                    >
                                        <option value="">All Lead Classes</option>
                                        {classes.map(c => (
                                            <option key={c.class_id} value={c.class_id.toString()}>
                                                {c.class_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Section Filter */}
                                <div className="col-6 col-md-3">
                                    <select
                                        className="form-select bg-light border"
                                        value={selectedSection}
                                        onChange={e => setSelectedSection(e.target.value)}
                                        style={{ borderRadius: '12px', fontSize: '0.88rem' }}
                                        title="Filter families where Eldest Child is in this section"
                                    >
                                        <option value="">All Sections</option>
                                        {availableSections.map(sec => (
                                            <option key={sec.section_id} value={sec.section_id ? sec.section_id.toString() : sec.section_name}>
                                                {sec.section_name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Reset Filter Button */}
                                {(searchTerm || selectedClass || selectedSection) && (
                                    <div className="col-12 col-md-auto d-flex align-items-center">
                                        <button
                                            type="button"
                                            className="btn btn-sm btn-outline-secondary w-100"
                                            style={{ borderRadius: '12px' }}
                                            onClick={() => {
                                                setSearchTerm('');
                                                setSelectedClass('');
                                                setSelectedSection('');
                                            }}
                                            title="Clear All Filters"
                                        >
                                            <i className="bi bi-arrow-counterclockwise me-1"></i>Reset
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Actions & View Controls */}
                        <div className="col-12 col-xl-5 d-flex flex-wrap justify-content-xl-end align-items-center gap-2">
                            {/* Layout Toggle (Table vs Cards) */}
                            <div className="btn-group btn-group-sm shadow-sm" role="group" style={{ borderRadius: '10px' }}>
                                <button
                                    type="button"
                                    className={`btn ${viewMode === 'table' ? 'btn-teal text-white' : 'btn-light border'}`}
                                    style={{ backgroundColor: viewMode === 'table' ? 'var(--primary-teal)' : undefined }}
                                    onClick={() => setViewMode('table')}
                                    title="Table View"
                                >
                                    <i className="bi bi-table me-1"></i>Table
                                </button>
                                <button
                                    type="button"
                                    className={`btn ${viewMode === 'cards' ? 'btn-teal text-white' : 'btn-light border'}`}
                                    style={{ backgroundColor: viewMode === 'cards' ? 'var(--primary-teal)' : undefined }}
                                    onClick={() => setViewMode('cards')}
                                    title="Mobile Cards View"
                                >
                                    <i className="bi bi-grid-fill me-1"></i>Cards
                                </button>
                            </div>

                            {/* Fee Slips Summary Columns Toggle */}
                            <button
                                type="button"
                                className={`btn btn-sm ${showFeeColumns ? 'btn-teal text-white' : 'btn-light border'} px-2.5 shadow-sm d-inline-flex align-items-center gap-1`}
                                style={{
                                    borderRadius: '10px',
                                    backgroundColor: showFeeColumns ? 'var(--primary-teal)' : undefined,
                                    color: showFeeColumns ? '#fff' : 'var(--primary-teal)'
                                }}
                                onClick={() => setShowFeeColumns(!showFeeColumns)}
                                title={showFeeColumns ? "Hide Detailed Fee Slip Columns" : "Show Detailed Fee Slip Columns"}
                            >
                                <i className={`bi ${showFeeColumns ? 'bi-cash-stack' : 'bi-currency-dollar'} fs-6`}></i>
                                <span className="small fw-semibold">{showFeeColumns ? 'Slips Summary' : 'Slips Summary'}</span>
                            </button>

                            {/* Export Buttons */}
                            <div className="btn-group btn-group-sm shadow-sm" role="group" style={{ borderRadius: '10px' }}>
                                <button
                                    type="button"
                                    className="btn btn-light border text-danger"
                                    onClick={exportPDF}
                                    title="Export PDF Document"
                                >
                                    <i className="bi bi-file-earmark-pdf-fill fs-6"></i>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-light border text-success"
                                    onClick={exportExcel}
                                    title="Export Excel Spreadsheet"
                                >
                                    <i className="bi bi-file-earmark-excel-fill fs-6"></i>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-light border text-primary"
                                    onClick={exportCSV}
                                    title="Export CSV File"
                                >
                                    <i className="bi bi-file-earmark-text-fill fs-6"></i>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-light border text-dark"
                                    onClick={exportPDF}
                                    title="Print Directory"
                                >
                                    <i className="bi bi-printer-fill fs-6"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Table or Responsive Cards Body */}
                <div className="card-body p-0">
                    {loading ? (
                        <div className="text-center py-5">
                            <div className="spinner-border text-teal mb-2" role="status" style={{ color: 'var(--primary-teal)' }}></div>
                            <div className="text-muted small">Loading Family Directory...</div>
                        </div>
                    ) : filteredFamilies.length === 0 ? (
                        <div className="text-center py-5 text-muted">
                            <i className="bi bi-people fs-1 d-block mb-2 opacity-50"></i>
                            <p className="mb-1 fw-bold">No family records found matching your filters.</p>
                            <small className="text-muted">Try resetting your class, section, or search query.</small>
                        </div>
                    ) : viewMode === 'table' ? (
                        /* Responsive Table View with Grouped Child Rows */
                        <div className="table-responsive family-table-container">
                            <table className="table table-hover align-middle mb-0 family-table" style={{ fontSize: '0.88rem' }}>
                                <thead style={{ backgroundColor: 'var(--primary-dark)', color: '#fff' }}>
                                    <tr>
                                        <th className="text-center" style={{ width: '3%', padding: '12px 8px' }}>Sr.#</th>
                                        <th style={{ width: showFeeColumns ? '15%' : '17%', padding: '12px 8px' }}>Family &amp; Households</th>
                                        <th style={{ width: '8%', padding: '12px 8px' }}>Family ID</th>
                                        <th style={{ width: '13%', padding: '12px 8px' }}>Monthly Fee &amp; OPB</th>
                                        {showFeeColumns && (
                                            <>
                                                <th className="text-end" style={{ width: '7%', padding: '12px 8px', backgroundColor: '#1e3a8a' }}>Total Bill</th>
                                                <th className="text-end" style={{ width: '7%', padding: '12px 8px', backgroundColor: '#065f46' }}>Paid</th>
                                                <th className="text-end" style={{ width: '7%', padding: '12px 8px', backgroundColor: '#991b1b' }}>Balance</th>
                                            </>
                                        )}
                                        <th style={{ width: showFeeColumns ? '16%' : '18%', padding: '12px 8px' }}>Enrolled Student</th>
                                        <th style={{ width: '7%', padding: '12px 8px' }}>Class</th>
                                        <th style={{ width: '6%', padding: '12px 8px' }}>Section</th>
                                        <th style={{ width: '11%', padding: '12px 8px' }}>Parents / Guardians</th>
                                        <th style={{ width: '14%', padding: '12px 8px' }}>Contacts &amp; WhatsApp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedFamilies.map((fam, famIdx) => {
                                        const globalSr = (pageSize === -1 ? 0 : (currentPage - 1) * pageSize) + famIdx + 1;
                                        const M = fam.activeMembers.length;
                                        const feeStatus = (fam.fee_status || 'paid').toLowerCase();
                                        const isSettled = fam.is_trusted_family || ['settled', 'satteled'].includes(feeStatus);
                                        const isUnpaid = !isSettled && feeStatus === 'unpaid';
                                        const isPartial = !isSettled && feeStatus === 'partial';
                                        const isCousin = fam.is_cousin_family;
                                        const monthlyFeeVal = fam.effective_monthly_fee || fam.family_fee || 0;
                                        const opbVal = fam.opb_remaining !== undefined ? fam.opb_remaining : (fam.opening_balance || 0);

                                        return fam.activeMembers.map((m, mIdx) => {
                                            const isFirst = mIdx === 0;
                                            const isMemberTrusted = m.is_trusted || (m.category || '').toLowerCase() === 'trusted';
                                            const isEldest = fam.eldest_child?.student_id === m.student_id;

                                            return (
                                                <tr
                                                    key={`${fam.family_id}-${m.student_id}`}
                                                    onClick={() => router.push(`/students/profile/${m.student_id}`)}
                                                    title={`Click to view ${m.full_name}'s student profile`}
                                                    style={{
                                                        backgroundColor: famIdx % 2 === 0 ? '#ffffff' : '#f8fafc',
                                                        borderTop: isFirst ? '2px solid #cbd5e1' : '1px dashed #e2e8f0',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    {/* 1. Sr.# (Rowspan) */}
                                                    {isFirst && (
                                                        <td
                                                            rowSpan={M}
                                                            className="text-center text-muted fw-bold align-middle border-end bg-light bg-opacity-50"
                                                        >
                                                            {globalSr}
                                                        </td>
                                                    )}

                                                    {/* 2. Family Information (Rowspan) with Cousin / Sibling / Trusted Badges */}
                                                    {isFirst && (
                                                        <td rowSpan={M} className="align-middle border-end">
                                                            <div className="d-flex align-items-center gap-1.5 flex-wrap">
                                                                <span
                                                                    className="fw-bold"
                                                                    style={{
                                                                        color: isSettled ? '#0891b2' : isUnpaid ? '#dc2626' : isPartial ? '#d97706' : '#1e293b',
                                                                        fontSize: '0.92rem'
                                                                    }}
                                                                >
                                                                    {isCousin ? (fam.combined_father_names || fam.family_name) : fam.family_name}
                                                                </span>
                                                            </div>

                                                            {/* Household Type & Trusted Settled Badges */}
                                                            <div className="mt-1 d-flex flex-wrap gap-1 align-items-center">
                                                                {isCousin ? (
                                                                    <span className="badge rounded-pill text-dark border px-2 py-0.5" style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', fontSize: '0.68rem' }}>
                                                                        <i className="bi bi-diagram-3-fill me-1 text-warning"></i>Siblings + Cousins
                                                                    </span>
                                                                ) : (
                                                                    <span className="badge rounded-pill bg-light text-secondary border px-2 py-0.5" style={{ fontSize: '0.68rem' }}>
                                                                        <i className="bi bi-people-fill me-1 text-teal" style={{ color: 'var(--primary-teal)' }}></i>Pure Siblings
                                                                    </span>
                                                                )}
                                                                {isSettled && (
                                                                    <span className="badge rounded-pill border px-2 py-0.5" style={{ backgroundColor: '#e0f2fe', borderColor: '#bae6fd', color: '#0369a1', fontSize: '0.68rem', fontWeight: 600 }}>
                                                                        <i className="bi bi-shield-check me-1"></i>Settled
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Child Count */}
                                                            <small className="text-muted d-block mt-1" style={{ fontSize: '0.74rem' }}>
                                                                <span>{fam.total_children} child{fam.total_children > 1 ? 'ren' : ''} in family</span>
                                                            </small>
                                                        </td>
                                                    )}

                                                    {/* 3. Family ID (Rowspan) */}
                                                    {isFirst && (
                                                        <td rowSpan={M} className="align-middle border-end">
                                                            <span className="badge rounded-pill text-dark border px-2.5 py-1" style={{ backgroundColor: '#f1f5f9', fontSize: '0.78rem' }}>
                                                                <i className="bi bi-tag-fill me-1 text-secondary"></i>
                                                                {fam.family_id}
                                                            </span>
                                                        </td>
                                                    )}

                                                    {/* 4. NEW COLUMN: Monthly Fee & OPB Arrears (Rowspan) */}
                                                    {isFirst && (
                                                        <td rowSpan={M} className="align-middle border-end bg-light bg-opacity-25">
                                                            <div className="d-flex flex-column gap-1.5">
                                                                <div className="d-flex align-items-center justify-content-between gap-1">
                                                                    <span className="text-muted small" style={{ fontSize: '0.72rem' }}>Monthly Fee:</span>
                                                                    <span className="fw-bold text-dark" style={{ fontSize: '0.82rem' }}>
                                                                        PKR {monthlyFeeVal.toLocaleString('en-PK')}
                                                                    </span>
                                                                </div>
                                                                <div className="d-flex align-items-center justify-content-between gap-1">
                                                                    <span className="text-muted small" style={{ fontSize: '0.72rem' }}>OPB Arrears:</span>
                                                                    <span
                                                                        className={`badge rounded-pill px-2 py-0.5 ${opbVal > 0 ? 'bg-danger-subtle text-danger border border-danger-subtle' : 'bg-success-subtle text-success border border-success-subtle'}`}
                                                                        style={{ fontSize: '0.7rem', fontWeight: 600 }}
                                                                    >
                                                                        PKR {opbVal.toLocaleString('en-PK')}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    )}

                                                    {/* Optional Fee Slips Columns: Total Bill, Paid, Balance */}
                                                    {showFeeColumns && isFirst && (
                                                        <>
                                                            <td rowSpan={M} className="align-middle text-end border-end fw-bold text-dark" style={{ backgroundColor: '#f8fafc' }}>
                                                                PKR {(isSettled ? 0 : (fam.total_billed || 0)).toLocaleString('en-PK')}
                                                            </td>
                                                            <td rowSpan={M} className="align-middle text-end border-end fw-bold text-success" style={{ backgroundColor: '#f0fdf4' }}>
                                                                PKR {(isSettled ? 0 : (fam.total_paid || 0)).toLocaleString('en-PK')}
                                                            </td>
                                                            <td rowSpan={M} className="align-middle text-end border-end fw-bold" style={{ backgroundColor: isSettled ? '#f0f9ff' : (fam.total_balance || 0) > 0 ? '#fef2f2' : '#f0fdf4', color: isSettled ? '#0284c7' : (fam.total_balance || 0) > 0 ? '#dc2626' : '#166534' }}>
                                                                {isSettled ? (
                                                                    <span className="badge rounded-pill px-2 py-1" style={{ backgroundColor: '#e0f2fe', color: '#0369a1', border: '1px solid #bae6fd', fontSize: '0.74rem' }}>
                                                                        <i className="bi bi-shield-check me-1"></i>Settled (PKR 0)
                                                                    </span>
                                                                ) : (
                                                                    `PKR ${(fam.total_balance || 0).toLocaleString('en-PK')}`
                                                                )}
                                                            </td>
                                                        </>
                                                    )}

                                                    {/* 5. Student Member Sub-Row Name with Lead Tag, Specific Father Tag & Trusted Tag */}
                                                    <td>
                                                        <div className="d-flex align-items-center gap-2">
                                                            <i className={`bi ${isEldest ? 'bi-star-fill text-warning' : 'bi-person-circle'}`} style={{ color: isEldest ? undefined : 'var(--primary-teal)', fontSize: '0.95rem' }} title={isEldest ? 'Lead / Eldest Child of Family' : 'Family Member'}></i>
                                                            <div>
                                                                <div className="d-flex align-items-center flex-wrap gap-1">
                                                                    <span className="fw-semibold text-dark" style={{ fontSize: '0.88rem' }}>
                                                                        {m.full_name}
                                                                    </span>
                                                                    <span className="badge bg-light text-muted border" style={{ fontSize: '0.7rem' }}>
                                                                        {m.admission_no}
                                                                    </span>
                                                                    {isEldest && (
                                                                        <span className="badge rounded-pill px-1.5 py-0.5" style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '0.65rem', fontWeight: 600 }}>
                                                                            <i className="bi bi-award me-0.5"></i>Lead
                                                                        </span>
                                                                    )}
                                                                    {isMemberTrusted && (
                                                                        <span className="badge rounded-pill px-1.5 py-0.5" style={{ backgroundColor: '#e0f2fe', color: '#0284c7', border: '1px solid #bae6fd', fontSize: '0.68rem', fontWeight: 600 }}>
                                                                            <i className="bi bi-shield-check me-1"></i>Trusted
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                {/* For cousin families, show specific father tag under student name */}
                                                                {isCousin && m.father_name && (
                                                                    <div className="text-muted mt-0.5" style={{ fontSize: '0.72rem' }}>
                                                                        <i className="bi bi-person-badge me-1"></i>s/d of <strong>{m.father_name}</strong>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>

                                                    {/* 6. Class */}
                                                    <td>
                                                        <span className="badge bg-primary bg-opacity-10 text-primary border border-primary-subtle px-2 py-1" style={{ fontSize: '0.78rem' }}>
                                                            {m.class_name}
                                                        </span>
                                                    </td>

                                                    {/* 7. Section */}
                                                    <td>
                                                        <span className="badge bg-secondary bg-opacity-10 text-dark border px-2 py-1" style={{ fontSize: '0.78rem' }}>
                                                            {m.section_name}
                                                        </span>
                                                    </td>

                                                    {/* 8. Parents / Guardians (Rowspan) */}
                                                    {isFirst && (
                                                        <td rowSpan={M} className="align-middle border-start border-end">
                                                            <div className="small">
                                                                {isCousin && fam.fathers_list && fam.fathers_list.length > 0 ? (
                                                                    fam.fathers_list.map((fa, faIdx) => (
                                                                        <div key={faIdx} className="mb-1">
                                                                            <span className="fw-semibold text-dark">
                                                                                <i className="bi bi-person-fill me-1 text-primary"></i>{fa.name}
                                                                            </span>
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <>
                                                                        <div className="fw-semibold text-dark">
                                                                            <i className="bi bi-person-badge me-1 text-primary"></i>
                                                                            {fam.father_name || 'N/A'}
                                                                        </div>
                                                                        {fam.mother_name && (
                                                                            <div className="text-muted mt-0.5" style={{ fontSize: '0.75rem' }}>
                                                                                <i className="bi bi-person me-1 text-secondary"></i>
                                                                                Mother: {fam.mother_name}
                                                                            </div>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </td>
                                                    )}

                                                    {/* 9. MERGED COLUMN: Contacts & WhatsApp (Rowspan) */}
                                                    {isFirst && (
                                                        <td rowSpan={M} className="align-middle border-end">
                                                            <div className="d-flex flex-column gap-1.5 small">
                                                                {isCousin && fam.fathers_list && fam.fathers_list.length > 0 ? (
                                                                    fam.fathers_list.map((fa, faIdx) => {
                                                                        const faWa = formatWhatsAppNumber(fa.phone);
                                                                        return fa.phone ? (
                                                                            <div key={faIdx} className="d-flex align-items-center justify-content-between gap-1.5 p-1 rounded bg-light border">
                                                                                <a
                                                                                    href={`tel:${fa.phone}`}
                                                                                    onClick={e => e.stopPropagation()}
                                                                                    className="text-decoration-none text-dark fw-semibold text-truncate d-flex align-items-center gap-1"
                                                                                    title={`Call ${fa.name}: ${fa.phone}`}
                                                                                    style={{ fontSize: '0.76rem' }}
                                                                                >
                                                                                    <i className="bi bi-telephone-fill text-success" style={{ fontSize: '0.68rem' }}></i>
                                                                                    <span>{fa.name.split(' ')[0]}: {fa.phone}</span>
                                                                                </a>
                                                                                {faWa && (
                                                                                    <a
                                                                                        href={`https://wa.me/${faWa}`}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        onClick={e => e.stopPropagation()}
                                                                                        className="btn btn-success btn-sm p-0 d-inline-flex align-items-center justify-content-center flex-shrink-0"
                                                                                        style={{ width: '22px', height: '22px', borderRadius: '6px', backgroundColor: '#25D366', borderColor: '#25D366' }}
                                                                                        title={`WhatsApp ${fa.name}`}
                                                                                    >
                                                                                        <i className="bi bi-whatsapp text-white" style={{ fontSize: '0.68rem' }}></i>
                                                                                    </a>
                                                                                )}
                                                                            </div>
                                                                        ) : null;
                                                                    })
                                                                ) : (
                                                                    <>
                                                                        {fam.father_phone && (
                                                                            <div className="d-flex align-items-center justify-content-between gap-1.5 p-1 rounded bg-light border">
                                                                                <a
                                                                                    href={`tel:${fam.father_phone}`}
                                                                                    onClick={e => e.stopPropagation()}
                                                                                    className="text-decoration-none text-dark fw-semibold text-truncate d-flex align-items-center gap-1"
                                                                                    title={`Call Father: ${fam.father_phone}`}
                                                                                    style={{ fontSize: '0.78rem' }}
                                                                                >
                                                                                    <i className="bi bi-telephone-fill text-success" style={{ fontSize: '0.7rem' }}></i>
                                                                                    <span>{fam.father_phone}</span>
                                                                                </a>
                                                                                {formatWhatsAppNumber(fam.father_phone) && (
                                                                                    <a
                                                                                        href={`https://wa.me/${formatWhatsAppNumber(fam.father_phone)}`}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        onClick={e => e.stopPropagation()}
                                                                                        className="btn btn-success btn-sm p-0 d-inline-flex align-items-center justify-content-center flex-shrink-0"
                                                                                        style={{ width: '22px', height: '22px', borderRadius: '6px', backgroundColor: '#25D366', borderColor: '#25D366' }}
                                                                                        title="WhatsApp Father"
                                                                                    >
                                                                                        <i className="bi bi-whatsapp text-white" style={{ fontSize: '0.68rem' }}></i>
                                                                                    </a>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                        {fam.mother_phone && (
                                                                            <div className="d-flex align-items-center justify-content-between gap-1.5 p-1 rounded bg-light border">
                                                                                <a
                                                                                    href={`tel:${fam.mother_phone}`}
                                                                                    onClick={e => e.stopPropagation()}
                                                                                    className="text-decoration-none text-dark fw-semibold text-truncate d-flex align-items-center gap-1"
                                                                                    title={`Call Mother: ${fam.mother_phone}`}
                                                                                    style={{ fontSize: '0.76rem' }}
                                                                                >
                                                                                    <i className="bi bi-telephone-fill text-success" style={{ fontSize: '0.68rem' }}></i>
                                                                                    <span className="text-muted small">M:</span> <span>{fam.mother_phone}</span>
                                                                                </a>
                                                                                {formatWhatsAppNumber(fam.mother_phone) && (
                                                                                    <a
                                                                                        href={`https://wa.me/${formatWhatsAppNumber(fam.mother_phone)}`}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        onClick={e => e.stopPropagation()}
                                                                                        className="btn btn-success btn-sm p-0 d-inline-flex align-items-center justify-content-center flex-shrink-0"
                                                                                        style={{ width: '22px', height: '22px', borderRadius: '6px', backgroundColor: '#25D366', borderColor: '#25D366' }}
                                                                                        title="WhatsApp Mother"
                                                                                    >
                                                                                        <i className="bi bi-whatsapp text-white" style={{ fontSize: '0.68rem' }}></i>
                                                                                    </a>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                        {!fam.father_phone && !fam.mother_phone && (
                                                                            <span className="text-muted">—</span>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                        });
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        /* Mobile / Tablet Responsive Squircle Cards View */
                        <div className="p-3">
                            <div className="row g-3">
                                {paginatedFamilies.map((fam, idx) => {
                                    const globalSr = (pageSize === -1 ? 0 : (currentPage - 1) * pageSize) + idx + 1;
                                    const waNumber = formatWhatsAppNumber(fam.primary_phone);
                                    const feeStatus = (fam.fee_status || 'paid').toLowerCase();
                                    const isSettled = fam.is_trusted_family || ['settled', 'satteled'].includes(feeStatus);
                                    const isCousin = fam.is_cousin_family;
                                    const monthlyFeeVal = fam.effective_monthly_fee || fam.family_fee || 0;
                                    const opbVal = fam.opb_remaining !== undefined ? fam.opb_remaining : (fam.opening_balance || 0);

                                    return (
                                        <div key={fam.family_id} className="col-12 col-md-6 col-xl-4">
                                            <div className="card h-100 border shadow-sm" style={{ borderRadius: '16px', overflow: 'hidden' }}>
                                                {/* Card Header */}
                                                <div className="card-header bg-light border-bottom p-3 d-flex justify-content-between align-items-center">
                                                    <div className="d-flex flex-wrap gap-1 align-items-center">
                                                        <span className="badge bg-secondary text-white rounded-pill px-2 py-0.5 me-1" style={{ fontSize: '0.72rem' }}>
                                                            #{globalSr}
                                                        </span>
                                                        <span className="badge rounded-pill text-dark border bg-white me-1">
                                                            {fam.family_id}
                                                        </span>
                                                        {isCousin ? (
                                                            <span className="badge rounded-pill bg-warning-subtle text-warning-emphasis border border-warning-subtle">
                                                                Siblings + Cousins
                                                            </span>
                                                        ) : (
                                                            <span className="badge rounded-pill bg-light text-secondary border">
                                                                Pure Siblings
                                                            </span>
                                                        )}
                                                        {isSettled && (
                                                            <span className="badge rounded-pill border" style={{ backgroundColor: '#e0f2fe', borderColor: '#bae6fd', color: '#0369a1', fontSize: '0.68rem', fontWeight: 600 }}>
                                                                <i className="bi bi-shield-check me-1"></i>Settled
                                                            </span>
                                                        )}
                                                    </div>
                                                    {waNumber && (
                                                        <a
                                                            href={`https://wa.me/${waNumber}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="btn btn-success btn-sm rounded-circle d-inline-flex align-items-center justify-content-center"
                                                            style={{ width: '30px', height: '30px', backgroundColor: '#25D366' }}
                                                            title="WhatsApp Primary Contact"
                                                        >
                                                            <i className="bi bi-whatsapp text-white" style={{ fontSize: '0.8rem' }}></i>
                                                        </a>
                                                    )}
                                                </div>

                                                {/* Card Body */}
                                                <div className="card-body p-3">
                                                    <h6 className="fw-bold mb-1" style={{ color: isSettled ? '#0891b2' : 'var(--primary-dark)' }}>
                                                        {isCousin ? (fam.combined_father_names || fam.family_name) : fam.family_name}
                                                    </h6>

                                                    {/* Contact info */}
                                                    <div className="small text-muted mb-2">
                                                        <i className="bi bi-telephone-fill text-success me-1"></i>
                                                        {fam.combined_phones || fam.primary_phone || 'No phone'}
                                                    </div>

                                                    {/* Fee & OPB Info Summary Badge */}
                                                    <div className="d-flex align-items-center justify-content-between p-2 rounded-3 bg-light border mb-2">
                                                        <div>
                                                            <span className="text-muted small d-block" style={{ fontSize: '0.7rem' }}>Monthly Fee</span>
                                                            <span className="fw-bold text-dark" style={{ fontSize: '0.82rem' }}>PKR {monthlyFeeVal.toLocaleString('en-PK')}</span>
                                                        </div>
                                                        <div className="text-end">
                                                            <span className="text-muted small d-block" style={{ fontSize: '0.7rem' }}>OPB Arrears</span>
                                                            <span className={`badge rounded-pill ${opbVal > 0 ? 'bg-danger-subtle text-danger border border-danger-subtle' : 'bg-success-subtle text-success border border-success-subtle'}`} style={{ fontSize: '0.72rem' }}>
                                                                PKR {opbVal.toLocaleString('en-PK')}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Children List in this family */}
                                                    <div className="border-top pt-2">
                                                        <div className="text-muted fw-bold mb-2 d-flex justify-content-between align-items-center" style={{ fontSize: '0.72rem', textTransform: 'uppercase' }}>
                                                            <span>Children ({fam.activeMembers.length}):</span>
                                                            {fam.eldest_child && (
                                                                <span className="text-warning-emphasis fw-semibold">
                                                                    <i className="bi bi-star-fill text-warning me-1"></i>Lead: {fam.eldest_child.class_name}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="d-flex flex-column gap-1.5">
                                                            {fam.activeMembers.map(m => {
                                                                const isMemberTrusted = m.is_trusted || (m.category || '').toLowerCase() === 'trusted';
                                                                const isEldest = fam.eldest_child?.student_id === m.student_id;
                                                                return (
                                                                    <div
                                                                        key={m.student_id}
                                                                        onClick={() => router.push(`/students/profile/${m.student_id}`)}
                                                                        className="p-2 rounded-3 bg-light d-flex justify-content-between align-items-center cursor-pointer"
                                                                        style={{ cursor: 'pointer', transition: 'background 0.2s' }}
                                                                    >
                                                                        <div>
                                                                            <div className="d-flex align-items-center flex-wrap gap-1">
                                                                                <span className="fw-bold text-dark" style={{ fontSize: '0.85rem' }}>{m.full_name}</span>
                                                                                {isEldest && (
                                                                                    <span className="badge rounded-pill px-1 py-0.5" style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', fontSize: '0.62rem' }}>
                                                                                        Lead
                                                                                    </span>
                                                                                )}
                                                                                {isMemberTrusted && (
                                                                                    <span className="badge rounded-pill px-1.5 py-0.5" style={{ backgroundColor: '#e0f2fe', color: '#0284c7', border: '1px solid #bae6fd', fontSize: '0.65rem' }}>
                                                                                        <i className="bi bi-shield-check me-1"></i>Trusted
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                                                                                Adm# {m.admission_no} {isCousin && m.father_name && `• s/d of ${m.father_name}`}
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-end">
                                                                            <span className="badge bg-primary bg-opacity-10 text-primary border border-primary-subtle me-1" style={{ fontSize: '0.72rem' }}>
                                                                                {m.class_name}
                                                                            </span>
                                                                            <span className="badge bg-secondary bg-opacity-10 text-dark border" style={{ fontSize: '0.72rem' }}>
                                                                                {m.section_name}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Modern Responsive Pagination Footer */}
                {filteredFamilies.length > 0 && (
                    <div className="card-footer bg-white border-top p-3 d-flex flex-column flex-md-row justify-content-between align-items-center gap-3" style={{ borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
                        {/* Info & Page Size Selector */}
                        <div className="d-flex align-items-center gap-3 flex-wrap">
                            <span className="text-muted small">
                                Showing <strong>{pageSize === -1 ? 1 : Math.min((currentPage - 1) * pageSize + 1, filteredFamilies.length)}</strong> to <strong>{pageSize === -1 ? filteredFamilies.length : Math.min(currentPage * pageSize, filteredFamilies.length)}</strong> of <strong>{filteredFamilies.length}</strong> families
                            </span>

                            <div className="d-flex align-items-center gap-1.5">
                                <label className="text-muted small mb-0" style={{ fontSize: '0.78rem' }}>Per page:</label>
                                <select
                                    className="form-select form-select-sm bg-light border"
                                    value={pageSize}
                                    onChange={e => setPageSize(parseInt(e.target.value, 10))}
                                    style={{ width: '85px', borderRadius: '8px', fontSize: '0.78rem' }}
                                >
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                    <option value={200}>200</option>
                                    <option value={-1}>All</option>
                                </select>
                            </div>
                        </div>

                        {/* Page Number Navigation Buttons */}
                        {pageSize !== -1 && totalPages > 1 && (
                            <nav aria-label="Families Pagination">
                                <ul className="pagination pagination-sm mb-0 gap-1">
                                    {/* First Page */}
                                    <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                                        <button
                                            className="page-link rounded-2 border"
                                            onClick={() => setCurrentPage(1)}
                                            disabled={currentPage === 1}
                                            title="First Page"
                                        >
                                            <i className="bi bi-chevron-double-left"></i>
                                        </button>
                                    </li>

                                    {/* Previous Page */}
                                    <li className={`page-item ${currentPage === 1 ? 'disabled' : ''}`}>
                                        <button
                                            className="page-link rounded-2 border"
                                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                            disabled={currentPage === 1}
                                            title="Previous Page"
                                        >
                                            <i className="bi bi-chevron-left"></i>
                                        </button>
                                    </li>

                                    {/* Dynamic Numeric Page Numbers */}
                                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                                        .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                                        .map((p, idx, arr) => {
                                            const prevP = arr[idx - 1];
                                            const showEllipsis = prevP && p - prevP > 1;

                                            return (
                                                <span key={p} className="d-flex align-items-center">
                                                    {showEllipsis && <span className="px-1 text-muted">...</span>}
                                                    <li className={`page-item ${currentPage === p ? 'active' : ''}`}>
                                                        <button
                                                            className={`page-link rounded-2 border ${currentPage === p ? 'text-white' : ''}`}
                                                            style={{
                                                                backgroundColor: currentPage === p ? 'var(--primary-teal)' : undefined,
                                                                borderColor: currentPage === p ? 'var(--primary-teal)' : undefined,
                                                                minWidth: '32px'
                                                            }}
                                                            onClick={() => setCurrentPage(p)}
                                                        >
                                                            {p}
                                                        </button>
                                                    </li>
                                                </span>
                                            );
                                        })}

                                    {/* Next Page */}
                                    <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                                        <button
                                            className="page-link rounded-2 border"
                                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                            disabled={currentPage === totalPages}
                                            title="Next Page"
                                        >
                                            <i className="bi bi-chevron-right"></i>
                                        </button>
                                    </li>

                                    {/* Last Page */}
                                    <li className={`page-item ${currentPage === totalPages ? 'disabled' : ''}`}>
                                        <button
                                            className="page-link rounded-2 border"
                                            onClick={() => setCurrentPage(totalPages)}
                                            disabled={currentPage === totalPages}
                                            title="Last Page"
                                        >
                                            <i className="bi bi-chevron-double-right"></i>
                                        </button>
                                    </li>
                                </ul>
                            </nav>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
